import { APP_BASE_NAME } from "../branding";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`${APP_BASE_NAME} splash screen`}
      >
        <img
          alt={APP_BASE_NAME}
          className="size-16 object-contain"
          src="/r3xcode-apple-touch-icon.png?v=20260824-2"
        />
      </div>
    </div>
  );
}
