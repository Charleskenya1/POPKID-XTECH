

import fs from 'fs';
import config from '../../config.cjs';
import pkg from '@whiskeysockets/baileys';
const { proto, downloadContentFromMessage } = pkg;

const prefix = config.PREFIX;
const antiDeleteGlobal = config.ANTI_DELETE;

const demonContext = {
  forwardingScore: 999,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: '120363290715861418@newsletter',
    newsletterName: "𝗽𝗼𝗽𝗸𝗶𝗱 𝗺𝗱 𝗯𝗼𝘁",
    serverMessageId: 143
  }
};

class DemonAntiDelete {
  constructor() {
    this.enabled = false;
    this.messageCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanExpiredMessages(), this.cacheExpiry);
  }

  cleanExpiredMessages() {
    const now = Date.now();
    for (const [key, msg] of this.messageCache.entries()) {
      if (now - msg.timestamp > this.cacheExpiry) {
        this.messageCache.delete(key);
      }
    }
  }

  formatTime(timestamp) {
    const options = {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    return new Date(timestamp).toLocaleString('en-PK', options) + ' (PKT)';
  }
}

const demonDelete = new DemonAntiDelete();
const statusPath = './demon_antidelete.json';

let statusData = {};
if (fs.existsSync(statusPath)) {
  statusData = JSON.parse(fs.readFileSync(statusPath));
}
if (!statusData.chats) statusData.chats = {};

// Automatically enable anti-delete if globally enabled
if (antiDeleteGlobal) {
  demonDelete.enabled = true;
}

const AntiDelete = async (m, Matrix) => {
  const chatId = m.from;
  const formatJid = (jid) => jid ? jid.replace(/@s\.whatsapp\.net|@g\.us/g, '') : 'Unknown';

  const getChatInfo = async (jid) => {
    if (!jid) return { name: 'Unknown Chat', isGroup: false };
    if (jid.includes('@g.us')) {
      try {
        const groupMetadata = await Matrix.groupMetadata(jid);
        return {
          name: groupMetadata?.subject || 'Popkid Corps',
          isGroup: true
        };
      } catch {
        return { name: 'Popkid Corps', isGroup: true };
      }
    }
    return { name: 'Private Mission', isGroup: false };
  };

  if (m.body.toLowerCase() === `${prefix}antidelete on` || m.body.toLowerCase() === `${prefix}antidelete off`) {
    const responses = {
      on: {
        text: `🚁 *Popkid Anti-Delete Activated*\n\n` +
              `• Protection: *Enabled*\n` +
              `• Cache: *5 minutes*\n` +
              `• Scope: *All Chats*\n\n` +
              `_Deleted messages will now be recovered_\n\n` +
              `🚁 *Popkid Corps*`,
        contextInfo: demonContext
      },
      off: {
        text: `🌑 *Popkid Anti-Delete Deactivated*\n\n` +
              `_Message recovery is now disabled_\n\n` +
              `⚔️ *Popkid Corps*`,
        contextInfo: demonContext
      }
    };

    if (m.body.toLowerCase() === `${prefix}antidelete on`) {
      statusData.chats[chatId] = true;
      fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
      demonDelete.enabled = true;
      await Matrix.sendMessage(m.from, responses.on, { quoted: m });
    } else {
      statusData.chats[chatId] = false;
      fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
      demonDelete.enabled = false;
      demonDelete.messageCache.clear();
      await Matrix.sendMessage(m.from, responses.off, { quoted: m });
    }

    await Matrix.sendReaction(m.from, m.key, '🗡️');
    return;
  }

  Matrix.ev.on('messages.upsert', async ({ messages }) => {
    if (!antiDeleteGlobal && !demonDelete.enabled) return;
    if (!messages?.length) return;

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message || msg.key.remoteJid === 'status@broadcast') continue;

      try {
        const content = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          msg.message.documentMessage?.caption;

        let media, type, mimetype;
        const mediaTypes = ['image', 'video', 'audio', 'sticker', 'document'];

        for (const mediaType of mediaTypes) {
          if (msg.message[`${mediaType}Message`]) {
            const mediaMsg = msg.message[`${mediaType}Message`];
            try {
              const stream = await downloadContentFromMessage(mediaMsg, mediaType);
              let buffer = Buffer.from([]);
              for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
              media = buffer;
              type = mediaType;
              mimetype = mediaMsg.mimetype;
              break;
            } catch {}
          }
        }

        if (msg.message.audioMessage?.ptt) {
          try {
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            media = buffer;
            type = 'voice';
            mimetype = msg.message.audioMessage.mimetype;
          } catch {}
        }

        if (content || media) {
          demonDelete.messageCache.set(msg.key.id, {
            content,
            media,
            type,
            mimetype,
            sender: msg.key.participant || msg.key.remoteJid,
            senderFormatted: `@${formatJid(msg.key.participant || msg.key.remoteJid)}`,
            timestamp: Date.now(),
            chatJid: msg.key.remoteJid
          });
        }
      } catch {}
    }
  });

  Matrix.ev.on('messages.update', async (updates) => {
    if (!antiDeleteGlobal && !demonDelete.enabled) return;
    if (!updates?.length) return;

    for (const update of updates) {
      try {
        const { key, update: updateData } = update;
        const isDeleted = updateData?.messageStubType === proto.WebMessageInfo.StubType.REVOKE ||
          updateData?.status === proto.WebMessageInfo.Status.DELETED;

        if (!isDeleted || key.fromMe || !demonDelete.messageCache.has(key.id)) continue;

        const cachedMsg = demonDelete.messageCache.get(key.id);
        demonDelete.messageCache.delete(key.id);

        const chatInfo = await getChatInfo(cachedMsg.chatJid);
        const deletedBy = updateData?.participant ?
          `@${formatJid(updateData.participant)}` :
          (key.participant ? `@${formatJid(key.participant)}` : 'Unknown Demon');

        const messageType = cachedMsg.type ?
          cachedMsg.type.charAt(0).toUpperCase() + cachedMsg.type.slice(1) :
          'Popkid Message';

        const baseInfo = `🗡️ *Popkid md: Recovered Deleted ${messageType}*\n\n` +
          `👤 *Popkid:* ${cachedMsg.senderFormatted}\n` +
          `⚔️ *Deleted By:* ${deletedBy}\n` +
          `📍 *Location:* ${chatInfo.name}${chatInfo.isGroup ? ' (Demon Nest)' : ''}\n` +
          `🕒 *Sent At:* ${demonDelete.formatTime(cachedMsg.timestamp)}\n` +
          `⏱️ *Deleted At:* ${demonDelete.formatTime(Date.now())}\n\n` +
          `_Popkid Corps Mission Log_`;

        if (cachedMsg.media) {
          await Matrix.sendMessage(cachedMsg.chatJid, {
            [cachedMsg.type]: cachedMsg.media,
            mimetype: cachedMsg.mimetype,
            caption: baseInfo,
            contextInfo: demonContext
          });
        } else if (cachedMsg.content) {
          await Matrix.sendMessage(cachedMsg.chatJid, {
            text: `${baseInfo}\n\n📜 *Message Scroll:* \n${cachedMsg.content}`,
            contextInfo: demonContext
          });
        }
      } catch {}
    }
  });
};

export default AntiDelete;
