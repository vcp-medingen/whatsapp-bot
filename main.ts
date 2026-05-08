import type { CacheStore } from "@whiskeysockets/baileys";
import makeWASocket, {
    Browsers,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    type WAMessage
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import NodeCache from "@cacheable/node-cache";
import { toString } from "qrcode";
import Fastify, {type FastifyRequest} from "fastify";
import { configDotenv } from "dotenv";

configDotenv();

const logger = pino({
    level: "trace",
    transport: {
        targets: [
            {
                target: "pino-pretty", // pretty-print for console
                options: { colorize: true },
                level: "debug",
            },
            {
                target: "pino/file", // raw file output
                options: { destination: './wa-logs.txt' },
                level: "warn",
            },
        ],
    },
})

const groupMetadataCache = new NodeCache() as CacheStore;

let sock: any = null;
let sockStatus: string = "close";

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
        browser: Browsers.macOS("Desktop")
    });

    sock.ev.on("connection.update", async (update) => {
        sockStatus = update.connection;
        if (update.qr) {
            console.log(await toString(update.qr, {type: "terminal"}))
        }

        if (update.connection === "close" && (update.lastDisconnect?.error)?.output?.statusCode === DisconnectReason.restartRequired) {
            await startSock();
        }

        if (update.connection === "open") {
            console.log("Connected to WhatsApp")
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on('messages.upsert', ({ messages }) => {
        console.log('got messages', messages)
        console.log(messages[0].message)
    })
}

startSock();

const prodJid: string | undefined = process.env.CHAT_ID;
const testJid: string | undefined = process.env.CHAT_TEST_ID;
const apiKey: string | undefined = process.env.API_KEY;
const port: number = Number(process.env.APP_PORT) || 3000;

if (!prodJid && !testJid) {
    throw Error("No WhatsApp jid specified")
}

function getJid(req: FastifyRequest): string {
    if (prodJid && !testJid) return prodJid;
    if (testJid && !prodJid) return testJid;

    if (req.query.test) {
        return testJid;
    }
    return prodJid;
}

const app = Fastify({
    bodyLimit: 2147000000,
});

app.get("/send", async (req, res) => {

    if (apiKey && req.query.api_key != apiKey) {
        res.code(401);
        return {
            "status": "error",
            "error": "API Key is incorrect"
        }
    }

    const message: string | undefined = req.query.message;
    const mediaUrl: string | undefined = req.query.media_url;
    const fileName: string | undefined = req.query.file_name;


    if (!message && !mediaUrl) {
        res.code(400);
        return {
            "status": "error",
            "error": "Missing query parameters"
        };
    }

    if (sock === undefined || sockStatus != "open") {
        res.code(500);
        return {
            "status": "error",
            "error": "WhatsApp Bot is offline"
        };
    }

    if (!mediaUrl) {
        try {
            console.log(message);
            await sock.sendMessage(getJid(req), {
                text: message
            });
        } catch (e) {
            res.code(400);
            return {
                "status": "error",
                "error": e
            }
        }
        res.code(200);
        return {
            "status": "success"
        };
    } else {
        if (!fileName) {
            res.code(400);
            return {
                "status": "error",
                "error": "Missing query parameters"
            };
        }

        try {
            await sock.sendMessage(getJid(req), {
                document: {
                    url: mediaUrl,
                },
                fileName: fileName,
                caption: message
            });

            res.code(200);
            return {
                "status": "success",
            };

        } catch (e) {
            res.code(400);
            return {
                "status": "error",
                "error": e
            }
        }
    }
})

app.post("/send", async (req, res) => {

    if (apiKey && req.query.api_key != apiKey) {
        res.code(401);
        return {
            "status": "error",
            "error": "API Key is incorrect"
        }
    }

    const message: string | undefined = req.query.message;
    const fileName: string | undefined = req.query.file_name;


    if (!message && !req.body.file) {
        res.code(400);
        return {
            "status": "error",
            "error": "Missing query parameters/file upload"
        };
    }

    if (sock === undefined || sockStatus != "open") {
        res.code(500);
        return {
            "status": "error",
            "error": "WhatsApp Bot is offline"
        };
    }

    if (!req.body.file) {
        try {
            await sock.sendMessage(getJid(req), {
                text: message
            });
        } catch (e) {
            res.code(400);
            return {
                "status": "error",
                "error": e
            }
        }
        res.code(200);
        return {
            "status": "success"
        };
    } else {
        if (!fileName) {
            res.code(400);
            return {
                "status": "error",
                "error": "Missing query parameters"
            };
        }

        try {
            await sock.sendMessage(getJid(req), {
                document: Buffer.from(req.body.file as string, "base64"),
                fileName: fileName,
                caption: message
            });

            res.code(200);
            return {
                "status": "success",
            };

        } catch (e) {
            res.code(400);
            return {
                "status": "error",
                "error": e
            }
        }
    }
})

app.get("/create-event", async (req, res) => {

    if (apiKey && req.query.api_key != apiKey) {
        res.code(401);
        return {
            "status": "error",
            "error": "API Key is incorrect"
        }
    }

    if (sock === undefined || sockStatus != "open") {
        res.code(500);
        return {
            "status": "error",
            "error": "WhatsApp Bot is offline"
        };
    }



    const eventName: string | undefined = req.query.name;
    const eventDescription: string | undefined = req.query.description;
    const eventLocation: string | undefined = req.query.location;
    const eventStart: string | undefined = req.query.start;
    const eventEnd: string | undefined = req.query.end;
    const pin: boolean = req.query.pin;

    if (!eventStart || !eventName) {
        res.code(400);
        return {
            "status": "error",
            "error": "Missing query parameters"
        };
    }

    const eventStartDate: Date = new Date(eventStart);
    if (isNaN(eventStartDate.getTime())) {
        res.code(400);
        return {
            "status": "error",
            "error": "Malformed date parameters"
        };
    }

    let eventEndDate: Date | undefined = undefined;
    if (eventEnd) {
        eventEndDate = new Date(eventEnd);
        if (isNaN(eventEndDate.getTime())) {
            res.code(400);
            return {
                "status": "error",
                "error": "Malformed date parameters"
            };
        }
    }

    const eventOpts = {
        name: eventName,
        description: eventDescription,
        startDate: eventStartDate,
        endDate: eventEndDate,
        location: {
            name: eventLocation
        },
    }

    try {
        const eventMessage: WAMessage = await sock.sendMessage(getJid(req), {
            event: eventOpts
        });

        if (pin) {
            let messagePinDuration: number = Math.ceil((eventStartDate.getTime() - Date.now())/1000) + 120 * 60;

            if (eventEndDate) {
                messagePinDuration = Math.ceil((eventEndDate.getTime() - Date.now())/1000)
            }

            await sock.sendMessage(getJid(req), {
                pin: eventMessage.key,
                type: 1,
                time: messagePinDuration
            })
        }
    } catch (e) {
        res.code(400);
        return {
            "status": "error",
            "error": e
        }
    }
    res.code(200);
    return {
        "status": "success"
    };
})

app.get("/change-title", async (req, res) => {

    if (apiKey && req.query.api_key != apiKey) {
        res.code(401);
        return {
            "status": "error",
            "error": "API Key is incorrect"
        }
    }

    if (sock === undefined || sockStatus != "open") {
        res.code(500);
        return {
            "status": "error",
            "error": "WhatsApp Bot is offline"
        };
    }

    const groupName: String | undefined = req.query.title;

    if (!groupName) {
        return {
            "status": "error",
            "error": "Missing query parameters"
        };
    }

    try {
        await sock.groupUpdateSubject(getJid(req), groupName)
    } catch (e) {
        res.code(400);
        return {
            "status": "error",
            "error": e
        }
    }
    res.code(200);
    return {
        "status": "success"
    };
})

app.get("/change-description", async (req, res) => {
    if (sock === undefined || sockStatus != "open") {
        res.code(500);
        return {
            "status": "error",
            "error": "WhatsApp Bot is offline"
        };
    }

    const groupDescription: String | undefined = req.query.description;

    if (!groupDescription) {
        return {
            "status": "error",
            "error": "Missing query parameters"
        };
    }

    try {
        await sock.groupUpdateDescription(getJid(req), groupDescription)
    } catch (e) {
        res.code(400);
        return {
            "status": "error",
            "error": e
        }
    }
    res.code(200);
    return {
        "status": "success"
    };
})

app.listen({
    port: port,
}).then(() => {
    console.log("Webserver is online! ")
});