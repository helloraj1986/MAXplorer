import packageMetadata from "../../package.json";
import appIconUrl from "../../branding/maxplorer-icon.svg";

/**
 * Single source of truth for user-facing product branding.
 *
 * The application version intentionally comes from package.json, which is the
 * version Tauri also embeds in the macOS bundle. Do not duplicate it here.
 */
export const PRODUCT_NAME = "MAXplorer";
export const TAGLINE = "More than just a file manager.";
export const BRAND_STATEMENT = "Your files. Your way.";
export const PRODUCT_DESCRIPTION = "A powerful, customisable desktop file manager.";
export const APP_VERSION = packageMetadata.version;
export const APP_ICON_URL = appIconUrl;
