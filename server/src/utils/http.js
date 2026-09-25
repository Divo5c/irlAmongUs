const maxRequestBodySize = 1024 * 1024;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;

    if (body.length > maxRequestBodySize) {
      throw new HttpError(413, 'Request body is too large.');
    }
  }

  if (!body) {
    throw new HttpError(400, 'Request body is required.');
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

module.exports = { HttpError, readJsonBody, sendJson };
