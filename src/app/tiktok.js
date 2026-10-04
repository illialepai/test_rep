/**
 * TikTok pages the app may open in the user's browser. URLs are always built here from a username, never
 * taken from the page, so the app can only ever open www.tiktok.com.
 */
export const TIKTOK_ORIGIN = "https://www.tiktok.com";

/** Profile page. When signed in, the owner sees "Edit profile" there, which holds the Username field. */
export function profileUrl(username) {
  return `${TIKTOK_ORIGIN}/@${encodeURIComponent(username)}`;
}

export function homeUrl() {
  return `${TIKTOK_ORIGIN}/`;
}

/**
 * Where to send the user to submit a username change:
 *  - "edit":   their current profile (Edit profile → Username), or the home page when no username is known
 *  - "verify": the profile URL of the new username, to check whether TikTok shows it
 */
export function submissionUrl({ purpose = "edit", existing = "", username = "" } = {}) {
  if (purpose === "verify") {
    if (!username) throw new Error("A username is required to open its profile.");
    return profileUrl(username);
  }
  return existing ? profileUrl(existing) : homeUrl();
}

export function isAllowedTikTokUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname === "www.tiktok.com" && !url.username && !url.password && !url.port;
}
