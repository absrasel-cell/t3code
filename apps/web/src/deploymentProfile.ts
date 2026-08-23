export const LLP_CHAT_ONLY_UI = import.meta.env.VITE_T3CODE_DEPLOYMENT_PROFILE === "llp-chat-only";

export function isLlpChatOnlyRestrictedRoute(pathname: string): boolean {
  return (
    pathname === "/connect" ||
    pathname.startsWith("/connect/") ||
    pathname === "/pull-requests" ||
    pathname === "/usage" ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/")
  );
}
