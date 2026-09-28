import { randomUUID } from 'node:crypto';
import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { themedEmbed } from './appearance.js';
import { number } from './presentation.js';
import { canManageBot, MANAGEMENT_DENIED } from './permissions.js';

const PREFIX = 'clan-reset:v1:';
const CONFIRM_MS = 120000;
const EVERYONE = 'ريست_الجميع';
const MEMBER = 'ريست_عضو';
const scopeLabel = userId => userId === null ? 'جميع أعضاء الكلان' : `<@${userId}>\n\`${userId}\``;
const targetLabel = target => target === 'bank' ? 'توب البنك' : target === 'activity' ? 'توب الشات والفويس' : 'تصفير شامل للعضو';
const effects = {
  bank: {
    preview: 'يصفّر أرصدة عملة البنك للجميع في التوب اليومي والأسبوعي والشهري والشامل.',
    done: 'تم تصفير أرصدة البنك للجميع في جميع الفترات. تبدأ الأرصدة من الصفر.',
    after: 'يبقى ترتيب الشات والفويس وتقدم المهمات ومهل الراتب والجائزة محفوظًا. تُضاف المكافآت الجديدة إلى الرصيد بعد التصفير.'
  },
  activity: {
    preview: 'يصفّر عدد رسائل الشات ووقت الفويس للجميع في التوب اليومي والأسبوعي والشهري والشامل.',
    done: 'تم تصفير توب الشات والفويس للجميع في جميع الفترات. يبدأ رصد النشاط الجديد بعد وقت الريست.',
    after: 'تبقى أرصدة البنك والمزايدات وتقدم المهمات ومهل الراتب والجائزة محفوظة.'
  },
  all: {
    preview: 'يمسح العملة 💵 وتقدم المهام اليومية والمؤقتة، ورسائل ترتيب الشات ووقت الفويس وأجزاء مكافأة الحضور. يشمل التوب اليومي والأسبوعي والشهري والشامل.',
    done: 'تم تصفير نقاط المهام والفويس وسجل الإنجاز والحضور في جميع الفترات. يبدأ الاحتساب من جديد بعد وقت الريست.',
    after: 'تبدأ مهام اليوم من الصفر ويمكن كسب مكافآتها مجددًا. تبقى عضوية الأعضاء ورتبهم وقوالب المهام وإعدادات البوت والتصميم محفوظة.'
  }
};

export function buildResetCommands() {
  return [
    new SlashCommandBuilder().setName(EVERYONE).setDescription('تصفير توب البنك أو توب الشات والفويس للجميع — يتطلب تأكيدًا')
      .addStringOption(o => o.setName('القسم').setDescription('القسم المطلوب تصفيره للجميع').setRequired(true)
        .addChoices({ name: 'توب البنك', value: 'bank' }, { name: 'توب الشات والفويس', value: 'activity' })),
    new SlashCommandBuilder().setName(MEMBER).setDescription('تصفير نقاط وتقدم عضو محدد في كل الفترات — يتطلب تأكيدًا')
      .addUserOption(o => o.setName('العضو').setDescription('العضو المطلوب تصفير نقاطه ومهامه').setRequired(true))
  ].map(command => command.setDefaultMemberPermissions(null));
}

// Short-lived destructive confirmations intentionally expire after restart.
// They are private, tied to their requester, and consumed before the first await.
export function createResetHandler({ config, service, store, access, onError = () => {}, clock = Date.now }) {
  const pending = new Map();
  const deny = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] } });
  const edit = (interaction, payload) => interaction.editReply({ content: '', embeds: [], components: [],
    allowedMentions: { parse: [] }, ...payload });
  return async interaction => {
    const button = interaction.isButton();
    const resetButton = button && interaction.customId.startsWith(PREFIX);
    if (!resetButton && (button || ![EVERYONE, MEMBER].includes(interaction.commandName))) return false;
    if (interaction.guildId !== config.clanGuildId) {
      await deny(interaction, 'أوامر الريست متاحة داخل سيرفر الكلان فقط.'); return true;
    }
    if (!canManageBot(interaction, config, access?.roleId)) {
      await deny(interaction, MANAGEMENT_DENIED); return true;
    }
    let request;
    let action;
    if (resetButton) {
      const match = /^clan-reset:v1:([a-f0-9-]{36}):(confirm|cancel)$/.exec(interaction.customId);
      request = match ? pending.get(match[1]) : null;
      if (request && request.ownerId !== interaction.user.id) {
        await deny(interaction, 'تأكيد الريست لصاحب الأمر فقط.'); return true;
      }
      if (!request || request.expiresAt <= clock()) {
        if (request) pending.delete(request.operationId);
        await deny(interaction, 'انتهت صلاحية هذا التأكيد أو استُخدم بالفعل. اكتب أمر الريست من جديد.'); return true;
      }
      pending.delete(request.operationId);
      action = match[2];
      await interaction.deferUpdate();
    } else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const settings = await store.settings();
      const appearance = settings?.appearance;
      if (resetButton) {
        if (action === 'cancel') {
          await edit(interaction, { embeds: [themedEmbed('تم إلغاء الريست', appearance)
            .setDescription('لم تُحذف أي نقاط أو مهام بهذا الطلب.')] });
          return true;
        }
        const result = await service.reset({ userId: request.userId, target: request.target,
          actorId: interaction.user.id, operationId: request.operationId });
        await edit(interaction, { embeds: [themedEmbed('تم الريست بنجاح', appearance)
          .setDescription(effects[request.target].done)
          .addFields(
            { name: 'النطاق', value: scopeLabel(request.userId) },
            { name: 'القسم', value: targetLabel(request.target) },
            { name: request.target === 'all' ? 'سجلات الأيام المحذوفة' : 'سجلات الأيام المصفّرة', value: number(result.changedDays ?? result.deletedDays), inline: true },
            { name: 'وقت الريست', value: `<t:${Math.floor(result.cutoff / 1000)}:F>`, inline: true },
            { name: 'بعد الريست', value: effects[request.target].after }
          )] });
        return true;
      }
      const userId = interaction.commandName === MEMBER ? interaction.options.getUser('العضو', true).id : null;
      const target = userId === null ? interaction.options.getString?.('القسم', true) : 'all';
      if (userId === null && !['bank', 'activity'].includes(target)) throw new Error('اختر القسم: توب البنك أو توب الشات والفويس. افتح /ريست_الجميع من جديد إذا لم يظهر الخيار.');
      const preview = await service.resetPreview(userId, target);
      // Supersede this administrator's earlier request and evict expired entries.
      for (const [key, value] of pending) if (value.expiresAt <= clock() || value.ownerId === interaction.user.id) pending.delete(key);
      const operationId = randomUUID();
      request = { operationId, userId, target, ownerId: interaction.user.id, expiresAt: clock() + CONFIRM_MS };
      pending.set(operationId, request);
      try {
        await edit(interaction, { embeds: [themedEmbed('تأكيد تصفير البيانات', appearance).setColor(0xed4245)
          .setDescription(`**هذا الإجراء لا يمكن التراجع عنه من البوت.**\n${effects[target].preview}`)
          .addFields(
            { name: 'النطاق المطلوب', value: scopeLabel(userId) },
            { name: 'القسم المطلوب', value: targetLabel(target) },
            { name: 'أعضاء لديهم سجلات', value: number(preview.members), inline: true },
            ...(target === 'activity' ? [
              { name: 'رسائل الشات', value: number(preview.chat), inline: true },
              { name: 'وقت الفويس', value: `${number(Math.floor(preview.voice / 1000))} ثانية`, inline: true }
            ] : [
              { name: 'عملة المهام', value: number(preview.tasks), inline: true },
              { name: 'عملة الحضور', value: number(preview.attendance), inline: true }
            ]),
            { name: 'بعد التأكيد', value: effects[target].after },
            { name: 'صلاحية التأكيد', value: `ينتهي <t:${Math.floor(request.expiresAt / 1000)}:R>. الأرقام وقت المعاينة؛ يشمل الريست بيانات القسم حتى تنفيذه.` }
          ),
        ], components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}${operationId}:confirm`).setLabel(userId === null ? `تأكيد ريست ${targetLabel(target)}` : 'تأكيد ريست العضو').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}${operationId}:cancel`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
        )] });
      } catch (error) { pending.delete(operationId); throw error; }
    } catch (error) {
      onError(error.cause || error);
      const message = error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
        ? error.message : 'تعذر إكمال الطلب. راجع سجل Render قبل إنشاء طلب جديد.';
      await edit(interaction, { content: `❌ ${message}` });
    }
    return true;
  };
}
