import { Client, LocalAuth, Chat, MessageMedia, Message } from "whatsapp-web.js"
import { generate, QRErrorCorrectLevel } from "jsr:@kingsword09/ts-qrcode-terminal";
import { wrapFetch } from "jsr:@jd1378/another-cookiejar@^5.0.7";
import "jsr:@std/dotenv/load";
import { Buffer } from "jsr:@std/io"
import {ScheduledEvent} from "npm:whatsapp-web.js@1.34.1";

const fetch = wrapFetch()


if (!Deno.env.get("CHAT_ID")) {
    console.error("CHAT_ID is required");
    Deno.exit(1);
}

if (!Deno.env.get("API_KEY")) {
    console.error("API_KEY is required");
    Deno.exit(1);
}


let prod_chat: Chat | undefined = undefined;
let test_chat: Chat | undefined = undefined;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  },
});

client.on("qr", (qr: string) => {
  console.log("QR RECEIVED", qr)
  generate(qr, { small: true, qrErrorCorrectLevel: QRErrorCorrectLevel.H })
      .then(console.log)
})

client.on("ready", async () => {
  console.log("Client is ready!")
  prod_chat = await client.getChatById(Deno.env.get("CHAT_ID")!);
  test_chat = await client.getChatById(Deno.env.get("CHAT_TEST_ID")!);
})



Deno.serve(async (req) => {
  if (!prod_chat) {
    return new Response(JSON.stringify({status: "error", error: "Client not ready"}), {status: 500});
  }
  if (req.method == "GET") {
    const url = new URL(req.url);
    const api_key = url.searchParams.get("api_key");
    const pin : boolean = url.searchParams.get("pin") === "true";
    let chat: Chat = prod_chat;
    if (url.searchParams.get("test") === "true") {
      chat = test_chat;
    }
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
        const response = await fetch(media_url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3' } });
        const blob = await response.blob();
        const file = await Deno.open("/tmp/" + file_name, {write: true, create: true});
        await file.write(new Buffer(await blob.arrayBuffer()).bytes());
        file.close();
        const media = MessageMedia.fromFilePath("/tmp/" + file_name);
        let sent_message: Message | undefined = undefined;
        if (message) {
          sent_message = await chat.sendMessage(message, {
            media: media,
            linkPreview: false,
          });
          if (pin) await sent_message?.pin(30*24*60*60);
          return new Response(JSON.stringify({status: "success"}), {status: 200});
        } else {
          sent_message = await chat.sendMessage(media);
          if (pin) await sent_message?.pin(30*24*60*60);
          return new Response(JSON.stringify({status: "success"}), {status: 200});
        }
      } else if (message) {
        const sent_message = await chat.sendMessage(message, {
          linkPreview: false,
        });
        if (pin) await sent_message?.pin(30*24*60*60);
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
    } else if (url.pathname == "/create-event") {
        const event_name = url.searchParams.get("name");
        const event_description = url.searchParams.get("description") || "";
        const event_location = url.searchParams.get("location") || "";
        const event_start = url.searchParams.get("start");
        const event_end = url.searchParams.get("end");
        if (!event_name || !event_start) {
            return new Response(JSON.stringify({status: "error", error: "name and start are required"}), {status: 400});
        }
        const start = new Date(event_start);
        if (isNaN(start.getTime())) {
            return new Response(JSON.stringify({status: "error", error: "Invalid start date"}), {status: 400});
        }
        let end: Date | undefined = undefined;
        if (event_end) {
            end = new Date(event_end);
            if (isNaN(end.getTime())) {
                return new Response(JSON.stringify({status: "error", error: "Invalid end date"}), {status: 400});
            }
        }
        const scheduledEvent = new ScheduledEvent(
            event_name,
            start,
            {
                description: event_description,
                location: event_location,
                end: end,
            }
        );
        await chat.sendMessage(scheduledEvent);
        return new Response(JSON.stringify({status: "success"}), {status: 200});
    }
    return new Response(JSON.stringify({status: "error", error: "Invalid request"}), {status: 400});
  }
}, {
  port: 80
});


client.initialize()