const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

export function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function channelLabel(channel: string): string {
  switch (channel) {
    case 'inapp':
      return 'In-app';
    case 'email':
      return 'Email';
    case 'whatsapp':
      return 'WhatsApp';
    default:
      return channel;
  }
}
