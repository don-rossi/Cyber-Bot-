/**
 * ⚡CyberBot MD - A WhatsApp Bot
 * Copyright (c) 2024 CyberTech
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * Powered by CyberTech
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization - Safe garbage collection
setInterval(() => {
    if (global.gc) {
        global.gc()
    }
}, 120_000)

let phoneNumber = "254732264858"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "⚡CYBERBOT⚡ MD"
global.themeemoji = "⚡"
const pairingCode =!!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

const rl = process.stdin.isTTY? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

async function startCyberBot() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const CyberBot = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal:!pairingCode,
            browser: ["⚡CyberBot⚡", "Chrome", "120.0.0"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        CyberBot.ev.on('creds.update', saveCreds)
        store.bind(CyberBot.ev)

        // Message handling
        CyberBot.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage')? mek.message.ephemeralMessage.message : mek.message

                // ⚡ AUTO REACT TO ALL COMMANDS
                const body = mek.message.conversation || mek.message.extendedTextMessage?.text || mek.message.imageMessage?.caption || mek.message.videoMessage?.caption || '';
                const prefix = settings.prefix || '.';
                if (body.startsWith(prefix) &&!mek.key.fromMe) {
                    try {
                        await CyberBot.sendMessage(mek.key.remoteJid, {
                            react: { text: '⚡', key: mek.key }
                        });
                    } catch (reactError) {
                        // Silent fail - bot continues normally
                    }
                }

                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(CyberBot, chatUpdate);
                    return;
                }

                if (!CyberBot.public &&!mek.key.fromMe && chatUpdate.type === 'notify') {
                    const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                    if (!isGroup) return
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

                if (CyberBot?.msgRetryCounterCache) {
                    CyberBot.msgRetryCounterCache.clear()
                }

                try {
                    await handleMessages(CyberBot, chatUpdate, true)
                } catch (err) {
                    console.error("Error in handleMessages:", err)
                    if (mek.key && mek.key.remoteJid) {
                        await CyberBot.sendMessage(mek.key.remoteJid, {
                            text: '❌ 𝐀𝐧 𝐞𝐫𝐫𝐨𝐫 𝐨𝐜𝐮𝐫𝐞𝐝 𝐰𝐡𝐢𝐥𝐞 𝐩𝐫𝐨𝐜𝐞𝐬𝐢𝐧𝐠 𝐲𝐨𝐮𝐫 𝐫𝐞𝐪𝐮𝐞𝐬𝐭.',
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363425593742170@newsletter',
                                    newsletterName: '⚡CyberBot⚡ by CyberTech',
                                    serverMessageId: -1
                                }
                            }
                        }).catch(console.error);
                    }
                }
            } catch (err) {
                console.error("Error in messages.upsert:", err)
            }
        })

        CyberBot.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        CyberBot.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = CyberBot.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        CyberBot.getName = (jid, withoutContact = false) => {
            id = CyberBot.decodeJid(jid)
            withoutContact = CyberBot.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = CyberBot.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net'? {
                id,
                name: 'WhatsApp'
            } : id === CyberBot.decodeJid(CyberBot.user.id)?
                CyberBot.user :
                (store.contacts[id] || {})
            return (withoutContact? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        CyberBot.public = true
        CyberBot.serializeM = (m) => smsg(CyberBot, m, store)

        if (pairingCode &&!CyberBot.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phoneNumber
            if (!!global.phoneNumber) {
                phoneNumber = global.phoneNumber
            } else {
                phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 254732264858 (without + or spaces) : `)))
            }

            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
            const pn = require('awesome-phonenumber');
            if (!pn('+' + phoneNumber).isValid()) {
                console.log(chalk.red('Invalid phone number. Please enter your full international number without + or spaces.'));
                process.exit(1);
            }

            setTimeout(async () => {
                try {
                    let code = await CyberBot.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                    console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`))
                } catch (error) {
                    console.error('Error requesting pairing code:', error)
                    console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'))
                }
            }, 3000)
        }

        CyberBot.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s

            if (qr) {
                console.log(chalk.yellow('📱 𝐐𝐑 𝐂𝐨𝐝𝐞 𝐠𝐞𝐧𝐞𝐫𝐚𝐭𝐞𝐝. 𝐏𝐥𝐞𝐚𝐬𝐞 𝐬𝐜𝐚𝐧 𝐰𝐢𝐭𝐡 𝐖𝐡𝐚𝐭𝐬𝐀𝐩.'))
            }

            if (connection === 'connecting') {
                console.log(chalk.yellow('🔄 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐢𝐧𝐠 𝐭𝐨 𝐖𝐡𝐚𝐭𝐬𝐀𝐩...'))
            }

            if (connection == "open") {
                console.log(chalk.magenta(` `))
                console.log(chalk.yellow(`🌿𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐞𝐝 𝐭𝐨 => ` + JSON.stringify(CyberBot.user, null, 2)))

                try {
                    const botNumber = CyberBot.user.id.split(':')[0] + '@s.whatsapp.net';
                    await CyberBot.sendMessage(botNumber, {
                        text: `🤖 𝐁𝐨𝐭 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐞𝐝 𝐒𝐮𝐜𝐞𝐬𝐟𝐮𝐥𝐥𝐲!\n\n⏰ 𝐓𝐢𝐦𝐞: ${new Date().toLocaleString()}\n✅ 𝐒𝐭𝐚𝐭𝐮𝐬: 𝐎𝐧𝐥𝐢𝐧𝐞 𝐚𝐧𝐝 𝐑𝐞𝐚𝐝𝐲!\n\n⚡𝐂𝐘𝐁𝐄𝐑𝐁𝐎𝐓⚡ 𝐌𝐃`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363425593742170@newsletter',
                                newsletterName: '⚡CyberBot⚡ by CyberTech',
                                serverMessageId: -1
                            }
                        }
                    });
                } catch (error) {
                    console.error('Error sending connection message:', error.message)
                }

                await delay(1999)

                // ⚡ HACKER SKULL BANNER - STYLE 2
                console.log(chalk.cyan(`
    ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣠⣤⣤⣄⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
    ⠀⠀⠀⠀⠀⠀⠀⢀⣠⣶⣿⣿⣿⣿⣶⣄⡀⠀⠀⠀⠀⠀⠀⠀
    ⠀⠀⠀⠀⠀⢀⣴⣿⣿⣦⡀⠀⠀⠀⠀⠀
    ⠀⠀⠀⠀⣠⣿⣿⣄⠀⠀⠀⠀
    ⠀⠀⠀⣰⣿⣿⣿⠿⢿⣿⣿⣿⣿⣆⠀⠀⠀
    ⠀⠀⢠⣿⣿⣿⣿⡿⠋⠁⠀⠀⠀⠀⠈⠙⢿⣿⣿⣿⣿⡄⠀⠀
    ⠀⠀⣾⣿⣿⣿⣿⡿⠋⠀⠀⠀⣠⣄⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣷⠀⠀
    ⠀⢸⣿⣿⣿⣿⠟⠀⠀⠀⠀⣼⣿⣿⣧⠀⠀⠀⠀⠀⠀⠻⣿⣿⡇⠀
    ⠀⣿⣿⣿⡿⠃⠀⠀⠀⠀⢠⣿⣿⣿⣿⡄⠀⠀⠀⠀⠀⠀⠘⢿⣿⣿⣿⠀
    ⠀⣿⣿⡟⠁⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠈⢻⣿⣿⣿⣿⠀
    ⠀⢿⣿⣿⣿⠁⠀⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⣿⡿⠀
    ⠀⠘⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⡿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⠃⠀
    ⠀⠀⢻⣿⣿⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⡟⠀⠀
    ⠀⠀⠀⠻⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⠟⠀⠀⠀
    ⠀⠀⠀⠀⠙⢿⣿⣿⣦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣴⣿⣿⡿⠋⠀⠀⠀⠀
    ⠀⠀⠀⠀⠀⠀⠙⠻⢿⣿⣿⣷⣶⣶⣾⣿⣿⡿⠟⠋⠀⠀⠀⠀⠀⠀⠀`))

                console.log(chalk.yellow(`\n${chalk.bold.cyan(`╔═══════════════════════════════════════════════╗`)}`))
                console.log(chalk.yellow(`${chalk.bold.cyan(`║`)} ${chalk.bold.white(`⚡ CYBERBOT MD ONLINE & READY ⚡`)} ${chalk.bold.cyan(`║`)}`))
                console.log(chalk.yellow(`${chalk.bold.cyan(`║`)} ${chalk.bold.white(` PROFESSIONAL • SECURE • FAST `)} ${chalk.bold.cyan(`║`)}`))
                console.log(chalk.yellow(`${chalk.bold.cyan(`╚═══════════════════════════════════════════════╝`)}\n`))

                console.log(chalk.cyan(`< ================================================== >`))
                console.log(chalk.magenta(`\n${global.themeemoji || '⚡'} 𝐆𝐈𝐓𝐇𝐔𝐁: github.com/don-rossi/Cyber-Bot-`))
                console.log(chalk.magenta(`${global.themeemoji || '⚡'} 𝐎𝐖𝐍𝐄𝐑: wa.me/254732264858`))
                console.log(chalk.magenta(`${global.themeemoji || '⚡'} 𝐂𝐑𝐄𝐃𝐈𝐓: 𝐂𝐲𝐛𝐞𝐫𝐓𝐞𝐜𝐡`))
                console.log(chalk.green(`${global.themeemoji || '⚡'} 🤖 𝐁𝐨𝐭 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐞𝐝 𝐒𝐮𝐜𝐞𝐬𝐟𝐮𝐥𝐥𝐲! ✅`))
                console.log(chalk.blue(`𝐁𝐨𝐭 𝐕𝐞𝐫𝐬𝐢𝐨𝐧: ${settings.version}`))
                console.log(chalk.cyan(`< ================================================== >\n`))
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode!== DisconnectReason.loggedOut
                const statusCode = lastDisconnect?.error?.output?.statusCode

                console.log(chalk.red(`Connection closed due to ${lastDisconnect?.error}, reconnecting ${shouldReconnect}`))

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true })
                        console.log(chalk.yellow('Session folder deleted. Please re-authenticate.'))
                    } catch (error) {
                        console.error('Error deleting session:', error)
                    }
                    console.log(chalk.red('Session logged out. Please re-authenticate.'))
                }

                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'))
                    await delay(5000)
                    startCyberBot()
                }
            }
        })

        const antiCallNotified = new Set();

        CyberBot.ev.on('call', async (calls) => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall');
                const state = readAnticallState();
                if (!state.enabled) return;
                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId;
                    if (!callerJid) continue;
                    try {
                        try {
                            if (typeof CyberBot.rejectCall === 'function' && call.id) {
                                await CyberBot.rejectCall(call.id, callerJid);
                            } else if (typeof CyberBot.sendCallOfferAck === 'function' && call.id) {
                                await CyberBot.sendCallOfferAck(call.id, callerJid, 'reject');
                            }
                        } catch {}

                        if (!antiCallNotified.has(callerJid)) {
                            antiCallNotified.add(callerJid);
                            setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                            await CyberBot.sendMessage(callerJid, { text: '📵 𝐀𝐧𝐭𝐢𝐜𝐚𝐥 𝐢𝐬 𝐞𝐧𝐚𝐛𝐥𝐞𝐝. 𝐘𝐨𝐮𝐫 𝐜𝐚𝐥𝐥 𝐰𝐚𝐬 𝐫𝐞𝐣𝐞𝐜𝐭𝐞𝐝 𝐚𝐧𝐝 𝐲𝐨𝐮 𝐰𝐢𝐥 𝐛𝐞 𝐛𝐥𝐨𝐜𝐤𝐞𝐝.' });
                        }
                    } catch {}
                    setTimeout(async () => {
                        try { await CyberBot.updateBlockStatus(callerJid, 'block'); } catch {}
                    }, 800);
                }
            } catch (e) {
                // ignore
            }
        });

        CyberBot.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(CyberBot, update);
        });

        CyberBot.ev.on('messages.upsert', async (m) => {
            if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
                await handleStatus(CyberBot, m);
            }
        });

        CyberBot.ev.on('status.update', async (status) => {
            await handleStatus(CyberBot, status);
        });

        CyberBot.ev.on('messages.reaction', async (status) => {
            await handleStatus(CyberBot, status);
        });

        return CyberBot
    } catch (error) {
        console.error('Error in startCyberBot:', error)
        await delay(5000)
        startCyberBot()
    }
}

startCyberBot().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache
    require(file)
})
