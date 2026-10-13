/**
 * A mail server that keeps everything it is sent, for tests.
 *
 * Just enough SMTP for nodemailer: greeting, EHLO, AUTH (PLAIN and LOGIN),
 * MAIL, RCPT, DATA, QUIT. Plain text over localhost - the app is pointed at it
 * with MBONYX_SMTP, so the sending code under test is the real sending code
 * and no letter can ever leave the machine.
 *
 * `rejectRcpt` makes it refuse one address the way a real server refuses a
 * mailbox that does not exist; `password` makes it refuse a wrong sign-in.
 */
import net from "node:net";

export function startFakeSmtp({ password = "abcdabcdabcdabcd", rejectRcpt = null } = {}) {
  const messages = [];
  const server = net.createServer(sock => {
    let buffer = "", inData = false, data = "", mail = {}, authStep = null, authed = false;
    const say = line => sock.write(line + "\r\n");
    say("220 fake.smtp ready");
    sock.on("data", chunk => {
      buffer += chunk.toString("utf8");
      let i;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push({ ...mail, raw: data });
            mail = {};
            say("250 2.0.0 queued as fake");
          } else data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          continue;
        }
        if (authStep === "user") { authStep = "pass"; say("334 UGFzc3dvcmQ6"); continue; }
        if (authStep === "pass") {
          authStep = null;
          authed = Buffer.from(line, "base64").toString() === password;
          say(authed ? "235 2.7.0 Accepted" : "535 5.7.8 Username and Password not accepted");
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") { sock.write("250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"); }
        else if (cmd === "AUTH") {
          const [, kind, payload] = line.split(" ");
          if (kind.toUpperCase() === "PLAIN") {
            const parts = Buffer.from(payload ?? "", "base64").toString().split("\0");
            authed = parts[2] === password;
            say(authed ? "235 2.7.0 Accepted" : "535 5.7.8 Username and Password not accepted");
          } else { authStep = "user"; say("334 VXNlcm5hbWU6"); }
        }
        else if (cmd === "MAIL") {
          if (!authed) { say("530 5.7.0 Authentication required"); continue; }
          mail = { from: line.match(/<([^>]*)>/)?.[1], to: [] }; say("250 OK");
        }
        else if (cmd === "RCPT") {
          const to = line.match(/<([^>]*)>/)?.[1];
          if (rejectRcpt && to === rejectRcpt) { say("550 5.1.1 The email account that you tried to reach does not exist"); continue; }
          mail.to.push(to); say("250 OK");
        }
        else if (cmd === "DATA") { inData = true; data = ""; say("354 go ahead"); }
        else if (cmd === "QUIT") { say("221 bye"); sock.end(); }
        else if (cmd === "RSET") { mail = {}; say("250 OK"); }
        else if (cmd === "NOOP") { say("250 OK"); }
        else say("502 not implemented");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
    port: server.address().port,
    messages,
    close: () => new Promise(r => server.close(r)),
  })));
}
