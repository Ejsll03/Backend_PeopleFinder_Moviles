import nodemailer from "nodemailer";

function getTransportConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  };
}

export async function sendEmailVerification({ to, fullName, token }) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    throw new Error("SMTP no configurado. Define SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS");
  }

  const transporter = nodemailer.createTransport(transportConfig);
  const appUrl = process.env.APP_BASE_URL || "http://localhost:5000";
  const verificationUrl = `${appUrl}/auth/verify-email?token=${token}`;
  const sender = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from: sender,
    to,
    subject: "Verifica tu correo en PeopleFinder",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.4; color: #111;">
        <h2>Hola ${fullName || "usuario"}</h2>
        <p>Gracias por registrarte en PeopleFinder.</p>
        <p>Para activar tu cuenta y obtener el estado de perfil verificado, confirma tu correo aquí:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>Este enlace expira en 24 horas.</p>
      </div>
    `,
    text: `Hola ${fullName || "usuario"}. Verifica tu correo en PeopleFinder: ${verificationUrl} (expira en 24 horas).`,
  });

  return verificationUrl;
}
