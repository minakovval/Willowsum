import { useEffect, useRef } from "react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider, MAIN_ID, ThemeProvider } from "@willowsum/ui";
import { CheckEmailPage } from "./auth/CheckEmailPage.tsx";
import { SignUpPage } from "./auth/SignUpPage.tsx";
import { VerifyPage } from "./auth/VerifyPage.tsx";
import { GalleryTokensPage } from "./pages/GalleryTokensPage.tsx";
import { ImportWizardPage } from "./pages/ImportWizardPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { ChildPage, SectionPage } from "./pages/SectionPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { canonicalPath, resolveRoute, type AuthScreen, type Route } from "./routing/routes.ts";
import { recordVisit, rememberPage } from "./routing/session.ts";
import { hrefFor, useHashPath } from "./routing/useHashPath.ts";

function Router() {
  const requested = useHashPath();
  // UX-09@PoC item 5: `/` opens «Планування → Бюджет»; a bare section path opens its root.
  const path = canonicalPath(requested);
  const route = resolveRoute(path);
  const first = useRef(true);

  useEffect(() => {
    if (requested !== path) window.location.replace(hrefFor(path));
  }, [requested, path]);

  useEffect(() => {
    recordVisit(path);
    const shown = resolveRoute(path);
    if (shown.kind === "page") rememberPage(shown.section.id, shown.page.path);
    if (shown.kind === "child") rememberPage(shown.section.id, shown.child.parent.path);
    // DS-14 item 8, GRID-00 item 11: after moving to another page, focus goes to the main area.
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById(MAIN_ID)?.focus();
    window.scrollTo(0, 0);
  }, [path]);

  // The design-system gallery demonstrates «Приховати суми» (kept for MVP); the PoC app has no such
  // mode (UX-09@PoC), so its pages always show amounts, whatever the gallery stored on this device.
  if (route.kind === "gallery")
    return (
      <HideAmountsProvider>
        <GalleryTokensPage />
      </HideAmountsProvider>
    );
  return <HideAmountsProvider initialHidden={false}>{appPage(route)}</HideAmountsProvider>;
}

function appPage(route: Exclude<Route, { kind: "gallery" }>) {
  switch (route.kind) {
    case "page":
      return <SectionPage section={route.section} page={route.page} />;
    case "child":
      return <ChildPage section={route.section} child={route.child} />;
    case "settings":
      return <SettingsPage />;
    case "importWizard":
      return <ImportWizardPage />;
    case "auth":
      return authPage(route.screen);
    case "notFound":
      return <NotFoundPage />;
  }
}

function authPage(screen: AuthScreen) {
  switch (screen) {
    case "signUp":
      return <SignUpPage />;
    case "checkEmail":
      return <CheckEmailPage />;
    case "verify":
      return <VerifyPage />;
  }
}

export function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <Router />
      </ThemeProvider>
    </I18nProvider>
  );
}
