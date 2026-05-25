const { google } = require('googleapis');
const { Readable } = require('stream');

const MAX_SIZE = 4 * 1024 * 1024;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Requisição inválida.' }) };
  }

  const { nome, email, departamento, tipo, arquivo, nomeArquivo, mimeType } = body;

  if (!nome || !email || !departamento || !tipo || !arquivo || !nomeArquivo) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Todos os campos são obrigatórios.' }) };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'E-mail inválido.' }) };
  }

  const buffer = Buffer.from(arquivo, 'base64');
  if (buffer.length > MAX_SIZE) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Arquivo excede o limite de 4 MB.' }) };
  }

  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  } catch {
    console.error('GOOGLE_SERVICE_ACCOUNT env var inválida');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuração do servidor incorreta.' }) };
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    console.error('GOOGLE_DRIVE_FOLDER_ID não configurada');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuração do servidor incorreta.' }) };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });

    const drive = google.drive({ version: 'v3', auth });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const safeName = `${timestamp}_${nome.replace(/\s+/g, '_')}_${tipo.replace(/\s+/g, '_')}_${nomeArquivo}`;

    const stream = Readable.from(buffer);

    const driveRes = await drive.files.create({
      requestBody: {
        name: safeName,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: stream,
      },
      fields: 'id,webViewLink',
    });

    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (sheetId) {
      const sheets = google.sheets({ version: 'v4', auth });
      const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Envios!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            dataHora,
            nome,
            email,
            departamento,
            tipo,
            safeName,
            driveRes.data.webViewLink || '',
          ]],
        },
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Erro ao enviar para o Drive:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro ao salvar o documento. Tente novamente.' }),
    };
  }
};
