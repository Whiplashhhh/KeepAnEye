/** Draws the favicon with a badge counting the sessions waiting for me; updates the tab title too. */
let lastKey = '';

export function updateAttention(waiting: number, baseTitle = 'Keep An Eye'): void {
  document.title = waiting > 0 ? `(${waiting}) ${baseTitle}` : baseTitle;
  const key = String(waiting);
  if (key === lastKey) return;
  lastKey = key;
  const link = document.getElementById('favicon') as HTMLLinkElement | null;
  if (!link) return;
  if (waiting === 0) {
    link.type = 'image/svg+xml';
    link.href = '/icons/favicon.svg';
    return;
  }
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, size, size);
    ctx.beginPath();
    ctx.arc(46, 18, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#0d1017';
    ctx.stroke();
    ctx.fillStyle = '#0d1017';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(waiting > 9 ? '9+' : String(waiting), 46, 19);
    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
  };
  img.src = '/icons/favicon.svg';
}
