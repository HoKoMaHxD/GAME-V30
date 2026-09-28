import { ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,SlashCommandBuilder } from 'discord.js';
import { bankMember } from './bank.js';
import { ActivityGate } from './activity-gate.js';
import { XO_MAX } from './xo.js';
import { XoManager } from './xo-commands.js';
export function buildNumbersCommand(){return new SlashCommandBuilder().setName('ارقام').setDescription('اختر رقمًا أو رقمين بالتناوب؛ من يصل إلى 15 يخسر مبلغ التحدّي')
 .addUserOption(o=>o.setName('العضو').setDescription('العضو المتحدّى').setRequired(true))
 .addIntegerOption(o=>o.setName('المبلغ').setDescription('المبلغ المحجوز من كل طرف').setMinValue(1).setMaxValue(XO_MAX).setRequired(true));}
export function numbersPayload(g){
 const amount=g.amount.toLocaleString('en-US');
 const title=`🔴 <@${g.x}> — 🟢 <@${g.o}>\nمبلغ التحدّي: **${amount} $** لكل طرف.\n\n`;
 const description=g.status==='pending'?`<@${g.o}>، تحدّاك <@${g.x}>!\nاختر رقمًا أو رقمين بالتتابع من 1 إلى 15؛ من يأخذ الرقم 15 يخسر مبلغ التحدّي لصالح خصمه كاملًا بدون ضريبة.\nيُختار اللاعب الأول عشوائيًا. عند القبول يُحجز المبلغ من الطرفين.\nلكل دور 15 ثانية؛ عدم الاختيار يُحسب خسارة.\nالدعوة 30 ثانية؛ تنتهي <t:${Math.ceil(g.expiresAt/1000)}:R>.\nانتظار إرسال التحدّي: 20 دقيقة على صاحب التحدّي فقط من القبول؛ استقبال التحديات متاح أثناء الانتظار.`:
  g.status==='active'?`الدور على <@${g.turn}> ${g.turn===g.x?'🔴':'🟢'}.\nاختر **1** لأخذ الرقم التالي أو **2** لأخذ الرقمين التاليين. من يأخذ 15 يخسر!\nوصلتم إلى **${g.count}**. مهلة الدور 15 ثانية؛ تنتهي <t:${Math.ceil(g.expiresAt/1000)}:R>.`:
  g.status==='won'?`${g.reason==='timeout'?'⏰ انتهت مهلة الاختيار؛ خسر صاحب الدور.':`اختار <@${g.loser}> الرقم **15** وخسر.`}\n🎉 فاز <@${g.winner}> بمبلغ **${amount} $** من خصمه، واسترجع مبلغه المحجوز. بدون ضريبة.`:
  g.status==='tie'?'🤝 تعادل؛ رجع لكل طرف مبلغه بدون ربح أو خسارة.':
  g.status==='rejected'?'رُفض التحدّي؛ لم يُخصم أي مبلغ.':g.reason==='balance'?'أُلغي التحدّي؛ رصيد أحد الطرفين لم يعد يكفي. لم يُحجز أي مبلغ.':'أُلغي التحدّي؛ أُعيدت أي مبالغ محجوزة للطرفين.';
 const embed=new EmbedBuilder().setColor(0x2b2d31).setTitle('أرقام').setDescription(title+description);if(g.author)embed.setAuthor(g.author);
 const button=(move,label,style)=>new ButtonBuilder().setCustomId(`numbers:v1:${g.id}:${g.revision}:${move}`).setLabel(label).setStyle(style);
 const components=g.status==='pending'?[new ActionRowBuilder().addComponents(button('accept','قبول',ButtonStyle.Success),button('reject','رفض',ButtonStyle.Danger))]:
  ['active','won','tie'].includes(g.status)?Array.from({length:3},(_,r)=>new ActionRowBuilder().addComponents(...Array.from({length:5},(_,c)=>{
   const cell=r*5+c+1,picked=g.picks.find(p=>p.cell===cell);
   return button(`cell${cell}`,String(cell),picked?(picked.userId===g.x?ButtonStyle.Danger:ButtonStyle.Success):ButtonStyle.Secondary).setDisabled(true);
  }))):[];
 if(g.status==='active')components.push(new ActionRowBuilder().addComponents(...[1,2].map(n=>button(String(n),String(n),ButtonStyle.Primary).setDisabled(g.count+n>15))));
 return {content:'',embeds:[embed],components,allowedMentions:{parse:[]}};
}
export function createNumbersHandler({config,service,isBankMember,numbersManager,onError=()=>{}}){
 const displays=numbersManager?.displays||new ActivityGate();
 return async i=>{
  const action=i.isButton?.()?/^numbers:v1:(\d{17,20}):(\d+):(accept|reject|[12])$/.exec(i.customId||''):null;
  if(!action&&i.commandName!=='ارقام'&&i.customId!=='numbers:help')return false;
  if(i.guildId!==config.clanGuildId||i.user.bot){await i.reply({content:'اللعبة لأعضاء سيرفر الكلان فقط.',flags:MessageFlags.Ephemeral});return true;}
  if(i.customId==='numbers:help'){await i.reply({content:'لبدء التحدّي اكتب: ارقام @العضو المبلغ، مثال: ارقام @العضو 1000. لازم الطرفين يملكون المبلغ، ويبدأ اللعب بعد قبول خصمك.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return true;}
  if(action)await i.deferUpdate();else await i.deferReply({});
  await displays.runSerial(action?.[1]||i.id,async()=>{
   try{
    const eligible=id=>isBankMember?isBankMember(id):bankMember(i,config,id);
    let g;
    if(action)g=await service.numbersGame.act({id:action[1],revision:Number(action[2]),move:action[3],userId:i.user.id,channelId:i.channelId},eligible);
    else{
     const target=i.options.getUser('العضو');
     const iconURL=i.user.displayAvatarURL?.({extension:'png',size:128});
     g=await service.numbersGame.open({id:i.id,x:i.user.id,o:target?.id,bot:!!target?.bot,channelId:i.channelId,amount:i.options.getInteger('المبلغ'),requireDelivery:true,
      author:{name:(i.member?.displayName||i.user.username||'عضو الكلان').slice(0,256),...(iconURL?{iconURL}:{})}},eligible);
    }
    const msg=await i.editReply(numbersPayload(g));
    if(msg?.id)await service.numbersGame.bind(g.id,msg.id);
    await service.numbersGame.displayed(g);
   }catch(e){onError(e);const p={content:/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر إكمال الطلب؛ حاول مجددًا.',allowedMentions:{parse:[]}};
    if(action)await i.followUp({...p,flags:MessageFlags.Ephemeral});else await i.editReply({...p,embeds:[],components:[]});}
  });return true;
 };
}
export class NumbersManager extends XoManager { constructor(ctx){super({...ctx,game:ctx.service.numbersGame,payload:numbersPayload});} }
