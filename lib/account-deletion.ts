/**
 * The phrase a user types to confirm deleting their account.
 *
 * A PROTOCOL TOKEN, NOT PROSE. Both delete routes compare it byte-for-byte
 * against what the client sent, so it is the same string in every language;
 * the sentence around it in `settingsPages.deleteAccount.typeToConfirm` is
 * prose and stays translated, interpolating this value as `{phrase}`.
 *
 * It lives here because three places independently spelled it out — the
 * confirmation dialog's button gate and BOTH delete routes
 * (app/api/account/delete, app/api/v1/users/me/delete) — and the eleven
 * translated copies of it in the locale files made a fourth through
 * fourteenth. Every non-English locale had translated the token while the
 * servers still required the English one, so a user who typed exactly what
 * the dialog asked for could not delete their account at all (AWTD-921).
 *
 * Do not translate it, and do not paste it into a locale file. If it ever has
 * to change, it changes here and the prompt follows in all twelve languages.
 */
export const ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT"
