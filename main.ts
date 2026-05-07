import makeWASocket, {
    Browsers,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState
} from "@whiskeysockets/baileys";

import type {CacheStore} from "@whiskeysockets/baileys";
import P from "pino";
import NodeCache from "@cacheable/node-cache";
import QRCode from "qrcode";


const logger = P({
    level: "trace",
    transport: {
        targets: [
            {
                target: "pino-pretty", // pretty-print for console
                options: { colorize: true },
                level: "trace",
            },
            {
                target: "pino/file", // raw file output
                options: { destination: './wa-logs.txt' },
                level: "trace",
            },
        ],
    },
})

const groupMetadataCache = new NodeCache() as CacheStore;

let sock: any = null;

async function startSock() {
    const {state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');


    sock = makeWASocket({
        logger: logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        generateHighQualityLinkPreview: true,
        cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid),
        shouldSyncHistoryMessage: () => false,
    });

    sock.ev.on("connection.update", async (update) => {
        if (update.qr) {
            console.log(await QRCode.toString(update.qr, {type: "terminal"}))
        }

        if (update.connection === "close" && (update.lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.restartRequired) {
            await startSock();
        }

        if (update.connection === "open") {
            await sock.sendMessage("120363370055424747@g.us", {text: "Test direct connection"})
        }
    });

    sock.ev.on("creds.update", saveCreds);
}


startSock();
