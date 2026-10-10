export function validRecognitionInput(body: Record<string, unknown>) {
  const name = typeof body.employeeName === 'string' ? body.employeeName.trim() : '';
  const reward = typeof body.rewardFor === 'string' ? body.rewardFor.trim() : '';
  const image = body.imageUrl == null || body.imageUrl === '' ? null : body.imageUrl;
  if (!name || name.length > 120 || !reward || reward.length > 300) return null;
  if (image !== null) {
    if (typeof image !== 'string' || image.length > 500) return null;
    // CSP allows same-origin images and the configured Supabase storage only.
    // Never publish an arbitrary third-party URL (tracking pixels / broken photos).
    if (image.startsWith('/')) {
      if (!/^\/rewards\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp)$/i.test(image)) return null;
    } else {
      try {
        const url = new URL(image);
        const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
        if (url.protocol !== 'https:' || url.origin !== supabase.origin ||
          !url.pathname.startsWith('/storage/v1/object/public/') || url.username || url.password) return null;
      } catch { return null; }
    }
  }
  const artwork = body.artworkIndex ?? 0;
  const order = body.sortOrder ?? 0;
  if (!Number.isInteger(artwork) || (artwork as number) < 0 || (artwork as number) > 2 ||
    !Number.isInteger(order) || (order as number) < 0 || (order as number) > 9999 ||
    typeof body.consentConfirmed !== 'boolean' || typeof body.isPublished !== 'boolean' ||
    (body.isPublished && !body.consentConfirmed)) return null;
  return {
    employee_name: name, reward_for: reward, image_url: image as string | null,
    artwork_index: artwork as number, sort_order: order as number,
    consent_confirmed: body.consentConfirmed, is_published: body.isPublished,
    updated_at: new Date().toISOString()
  };
}
