import { Client, RemoteAuth, Chat, MessageMedia } from "whatsapp-web.js"
import { MongoStore } from "wwebjs-mongo";
import * as mongoose from "mongoose";
import { generate, QRErrorCorrectLevel } from "jsr:@kingsword09/ts-qrcode-terminal";
import "jsr:@std/dotenv/load";

const mongodb_uri = Deno.env.get("MONGODB_URI");

if (!mongodb_uri) {
    console.error("MONGODB_URI is required");
    Deno.exit(1);
}

if (!Deno.env.get("CHAT_ID")) {
    console.error("CHAT_ID is required");
    Deno.exit(1);
}

if (!Deno.env.get("API_KEY")) {
    console.error("API_KEY is required");
    Deno.exit(1);
}

await mongoose.connect(Deno.env.get("MONGODB_URI")!.toString());

let chat: Chat | undefined = undefined;

const client = new Client({
  puppeteer: {
    headless: true,
  },
  authStrategy: new RemoteAuth({
    store: new MongoStore(mongoose),
    backupSyncIntervalMs: 300000,
  }),
})

client.on("qr", qr => {
  console.log("QR RECEIVED", qr)
  generate(qr, { small: true, white: "⬜️", black: "⬛️", qrErrorCorrectLevel: QRErrorCorrectLevel.H })
      .then(console.log)
})

client.on("ready", async () => {
  console.log("Client is ready!")
  chat = await client.getChatById(Deno.env.get("CHAT_ID")!);
})

Deno.serve(async (req) => {
  if (!chat) {
    return new Response(JSON.stringify({status: "error", error: "Client not ready"}), {status: 500});
  }
  if (req.method == "GET") {
    const url = new URL(req.url);
    const api_key = url.searchParams.get("api_key");
    if (api_key !== Deno.env.get("API_KEY")) {
      return new Response(JSON.stringify({status: "error", error: "Unauthorized"}), {status: 401});
    }
    if (url.pathname == "/send") {
      const message = url.searchParams.get("message");
      const media_url = url.searchParams.get("media_url");
      if (media_url) {
        const media: MessageMedia = await MessageMedia.fromUrl(media_url, {
          unsafeMime: true,
        });
        if (message) {
          await chat.sendMessage(message, {
            media: media,
            linkPreview: false,
          });
          return new Response(JSON.stringify({status: "success"}), {status: 200});
        } else {
          await chat.sendMessage(media);
          return new Response(JSON.stringify({status: "success"}), {status: 200});
        }
      } else if (message) {
        await chat.sendMessage(message, {
          linkPreview: false,
        });
        return new Response(JSON.stringify({status: "success"}), {status: 200});
      }
    } else if (url.pathname == "/change-title") {
      const title = url.searchParams.get("title");
      if (title) {
        await chat.setSubject(title);
        return new Response(JSON.stringify({status: "success"}), {status: 200});

      }
    }
    return new Response(JSON.stringify({status: "error", error: "Invalid request"}), {status: 400});
  }
}, {
  port: 80
});

client.initialize()