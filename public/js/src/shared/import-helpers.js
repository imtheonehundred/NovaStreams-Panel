export async function readOptionalFileText(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return '';
  return await file.text();
}

export function extractFirstHttpUrl(text) {
  const match = String(text || '').match(/https?:\/\/\S+/i);
  return match ? match[0].trim() : '';
}

export function parseBulkUsersText(text, dateFormat = 'ymd') {
  const lines = String(text || '').split('\n').map((row) => row.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const parts = line.split(':');
    const username = (parts[0] || '').trim();
    const password = (parts[1] || '').trim() || Math.random().toString(36).slice(2, 12);
    const expiryRaw = (parts[2] || '').trim();
    return {
      username,
      password,
      exp_date: normalizeExpiryDate(expiryRaw, dateFormat),
      _row: index + 1,
    };
  });
}

function normalizeExpiryDate(value, format) {
  if (!value) return undefined;
  const parts = String(value).split('-');
  if (parts.length !== 3) return undefined;
  let year;
  let month;
  let day;
  if (format === 'dmy') {
    [day, month, year] = parts;
  } else if (format === 'mdy') {
    [month, day, year] = parts;
  } else {
    [year, month, day] = parts;
  }
  const ts = Date.parse(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : undefined;
}
