// The web app's public origin: where a shared career page or a testimonial
// invitation actually opens, since those pages exist only on the web.
export const WEB_BASE_URL = "https://kall.skaldandstone.com";

export const careerPageUrl = (slug: string) => `${WEB_BASE_URL}/p/${slug}`;
export const testimonialInviteUrl = (token: string) => `${WEB_BASE_URL}/testimonial-submit?token=${encodeURIComponent(token)}`;
