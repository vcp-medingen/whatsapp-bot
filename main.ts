import { Client, RemoteAuth, Chat, MessageMedia, Message } from "whatsapp-web.js"
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

console.log("Connecting to URI ", Deno.env.get("MONGODB_URI"));
await mongoose.connect(Deno.env.get("MONGODB_URI")!.toString()).catch((err: Error) => {
    console.error("Failed to connect to MongoDB", err);
    Deno.exit(1);
});

mongoose.connection.on("error", (err: Error) => {
    console.error("MongoDB connection error", err);
    Deno.exit(1);
});

let chat: Chat | undefined = undefined;

const client = new Client({
  authStrategy: new RemoteAuth({
    store: new MongoStore(
        {
          mongoose: mongoose
        }
    ),
    backupSyncIntervalMs: 300000,
  })
});

client.on("qr", (qr: string) => {
  console.log("QR RECEIVED", qr)
  generate(qr, { small: true, qrErrorCorrectLevel: QRErrorCorrectLevel.H })
      .then(console.log)
})

client.on("ready", async () => {
  console.log("Client is ready!")
  console.log(mongoose.connection.readyState);
  chat = await client.getChatById(Deno.env.get("CHAT_ID")!);
})

client.on('remote_session_saved', () => {
    console.log('Remote session saved in MongoDB. ');
});


Deno.serve(async (req) => {
  if (!chat) {
    return new Response(JSON.stringify({status: "error", error: "Client not ready"}), {status: 500});
  }
  if (req.method == "GET") {
    const url = new URL(req.url);
    const api_key = url.searchParams.get("api_key");
    const pin : boolean = url.searchParams.get("pin") === "true";
    if (api_key !== Deno.env.get("API_KEY")) {
      return new Response(JSON.stringify({status: "error", error: "Unauthorized"}), {status: 401});
    }
    if (url.pathname == "/send") {
      const message = url.searchParams.get("message");
      const media_url = url.searchParams.get("media_url");
      const file_name = url.searchParams.get("file_name");
      if (media_url && !file_name) {
        return new Response(JSON.stringify({status: "error", error: "file_name is required"}), {status: 400});
      }
      if (media_url && file_name) {
        const response = await fetch(media_url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
            }
        });
        const file = await Deno.open("/tmp/" + file_name, {write: true, create: true});
        await response.body?.pipeTo(file.writable);
        file.close();
        const media = MessageMedia.fromFilePath("/tmp/" + file_name);
        let sent_message: Message | undefined = undefined;
        if (message) {
          sent_message = await chat.sendMessage(message, {
            media: media,
            linkPreview: false,
          });
          if (pin) await sent_message?.pin(29*24*60*60);
          await Deno.remove("/tmp/" + file_name);
          return new Response(JSON.stringify({status: "success"}), {status: 200});
        } else {
          sent_message = await chat.sendMessage(media);
          if (pin) await sent_message?.pin(29*24*60*60);
          await Deno.remove("/tmp/" + file_name);
          return new Response(JSON.stringify({status: "success"}), {status: 200});
        }
      } else if (message) {
        const sent_message = await chat.sendMessage(message, {
          linkPreview: false,
        });
        if (pin) await sent_message?.pin(29*24*60*60);
        return new Response(JSON.stringify({status: "success"}), {status: 200});
      }
    } else if (url.pathname == "/change-title") {
      const title = url.searchParams.get("title");
      if (title) {
        await chat.setSubject(title);
        return new Response(JSON.stringify({status: "success"}), {status: 200});

      }
    } else if (url.pathname == "/change-description") {
        const description = url.searchParams.get("description");
        if (description) {
            if(await chat.setDescription(description)){
              return new Response(JSON.stringify({status: "success"}), {status: 200});
            } else {
              return new Response(JSON.stringify({status: "error", error: "Failed to set description"}), {status: 500});
            }
        }
    }
    return new Response(JSON.stringify({status: "error", error: "Invalid request"}), {status: 400});
  }
}, {
  port: 80
});


client.initialize()