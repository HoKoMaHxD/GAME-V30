import { createHash, randomUUID } from 'node:crypto';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { netPoints } from './point-adjustments.js';
export const FINANCIAL_CHANNEL = '1554179860396642335';
const fields = {points:'مكافآت المهام والحضور',pointAdjustments:'تعديل إداري',shopAdjustments:'شراء من المتجر',robberyAdjustments:'نهب',auctionAdjustments:'حجز / تسوية مزاد أو تحدي',protectionAdjustments:'شراء حماية',miniAdjustments:'نرد / ألوان',bankResetAdjustments:'تصفير البنك',salaryCredits:'راتب',prizeCredits:'جائزة'};
const logs = ['completionLog','adjustmentLog','salaryReceipts','prizeReceipts','miniReceipts','auctionReceipts','robberyReceipts','shopReceipts','protectionReceipts','financialSettlementReceipts'];
export function financialEvent(before, after, balance, now) {
 const changes = Object.entries(fields).filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(([key,label])=>({source:label,field:key,before:before[key]??0,after:after[key]??0}));
 const delta = netPoints(after).total-netPoints(before).total;
 const receipts = {};
 for(const key of logs){const known=new Set((before[key]||[]).map(x=>JSON.stringify(x)));const added=(after[key]||[]).filter(x=>!known.has(JSON.stringify(x)));if(added.length)receipts[key]=added;}
 if(!delta && !Object.keys(receipts).length && !changes.length)return null;
 const id=createHash('sha256').update(`${after._id}:${after.financialEpoch || after.createdAt || 0}:${(before.revision||0)+1}`).digest('hex').slice(0,24);
 return {_id:id,clanId:after.clanId,userId:after.userId,dayId:after._id,at:now,delta,before:balance,after:balance+delta,changes,receipts,
  tasks:(receipts.completionLog||[]).map(e=>({...e,title:after.tasks?.find(t=>t.id===e.taskId)?.title})),context:after.financialContext||null,delivered:false};
}
export async function stageFinancial(store,before,after){
 if(!store.financialAudit)return;
 after.financialEpoch ||= randomUUID();
 const event=financialEvent(before,after,0,Date.now());
 if(event){const balance=(await store.totals(after.userId,'all',Date.now())).total;event.before=balance;event.after=balance+event.delta;(after.financialPending ||= []).push(event);}
 delete after.financialContext;
}
export async function archiveFinancial(store,day){
 for(const event of day.financialPending||[])await store.db.collection('financial_logs').updateOne({_id:event._id},{$setOnInsert:event},{upsert:true});
 // Atomic pull leaves concurrently appended events intact. A stale replacement can
 // restore old IDs, but archive IDs and delivered markers prevent another send.
 if(day.financialPending?.length)await store.db.collection('days').updateOne({_id:day._id},{$pull:{financialPending:{_id:{$in:day.financialPending.map(e=>e._id)}}}});
}
export function financialPayload(e){
 const money=n=>`${Number(n).toLocaleString('en-US')} $`;
 const reason=[...new Set(e.changes.map(c=>c.source))].join(' • ')||'تسوية بدون تغيير الرصيد';
 const context=e.context||{};
 const info = Object.entries(context).filter(([k,v])=>v!=null&&typeof v!=='object').map(([k,v])=>`${({game:'اللعبة',roundId:'معرف الجولة',initiator:'صاحب التحدي',opponent:'الطرف الثاني',stake:'مبلغ التحدي',status:'الحالة',winner:'الفائز',reason:'السبب',channelId:'الشات',actorId:'الإداري',operationId:'معرف العملية',source:'المصدر',outcome:'النتيجة',netResult:'صافي نتيجة الجولة'})[k]||k}: ${v}`).join('\n');
 const details=e.tasks.map(t=>`${t.title||t.taskId}: ${money(t.points)}${t.multiplier?` (×${t.multiplier})`:''}`).join('\n');
 const embed=new EmbedBuilder().setTitle(e.delta>0?'💰 إضافة رصيد':e.delta<0?'💸 خصم / حجز رصيد':'⚖️ تسوية مالية بدون تغيير').setColor(e.delta>0?0x4fb687:e.delta<0?0xc96565:0xf2b84b)
 .setDescription(`<@${e.userId}>\nمعرف العضو: ${e.userId}\n**${reason}**`)
 .addFields({name:'التغيير',value:`${e.delta>0?'+':''}${money(e.delta)}`,inline:true},{name:'قبل العملية',value:money(e.before),inline:true},{name:'بعد العملية',value:money(e.after),inline:true},
 {name:'التفاصيل',value:([details,info].filter(Boolean).join('\n')||'تفاصيل العملية ومعرفاتها محفوظة في الملف المرفق.').slice(0,1024)})
 .setTimestamp(e.at).setFooter({text:`سجل مالي #${e._id}`});
 return {embeds:[embed],files:[new AttachmentBuilder(Buffer.from(JSON.stringify(e,null,2)),{name:`financial-${e._id}.json`})],allowedMentions:{parse:[]},nonce:e._id,enforceNonce:true};
}
export class FinancialLogger{
 constructor(ctx){Object.assign(this,ctx);this.running=null;}
 tick(){if(this.running||!this.canRun())return this.running||Promise.resolve();this.running=this.flush().catch(this.onError).finally(()=>{this.running=null;});return this.running;}
 async drain(){await this.running;}
 async flush(){
  const store=this.store,clanId=store.config.clanGuildId;
  for(const day of await store.db.collection('days').find({clanId,'financialPending.0':{$exists:true}}).limit(100).toArray())await archiveFinancial(store,day);
  const events=await store.db.collection('financial_logs').find({clanId,delivered:false}).sort({at:1,_id:1}).limit(20).toArray();if(!events.length)return;
  const channel=await this.bot.channels.fetch(FINANCIAL_CHANNEL);if(channel?.guildId!==clanId||!channel.isTextBased())throw new Error('شات السجل المالي غير متاح في سيرفر الكلان.');
  const history=await channel.messages.fetch({limit:100});
  for(const e of events){if(!this.canRun())break;await store.requireLease(Date.now());
   const existing=[...history.values()].find(m=>m.author?.id===this.bot.user.id&&m.embeds?.some(x=>x.footer?.text===`سجل مالي #${e._id}`));
   const message=existing||await channel.send(financialPayload(e));
   await store.db.collection('financial_logs').updateOne({_id:e._id},{$set:{delivered:true,messageId:message.id,deliveredAt:Date.now()}});
  }
 }
}
