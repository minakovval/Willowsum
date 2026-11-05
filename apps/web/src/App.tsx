import { useEffect, useRef } from "react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider, MAIN_ID, ThemeProvider } from "@willowsum/ui";
import { GalleryTokensPage } from "./pages/GalleryTokensPage.tsx";
import { ImportWizardPage } from "./pages/ImportWizardPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { ChildPage, SectionPage } from "./pages/SectionPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { canonicalPath, resolveRoute } from "./routing/routes.ts";
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

  switch (route.kind) {
    case "gallery":
      return <GalleryTokensPage />;
    case "page":
      return <SectionPage section={route.section} page={route.page} />;
    case "child":
      return <ChildPage section={route.section} child={route.child} />;
    case "settings":
      return <SettingsPage />;
    case "importWizard":
      return <ImportWizardPage />;
    case "notFound":
      return <NotFoundPage />;
  }
}

export function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <HideAmountsProvider>
          <Router />
        </HideAmountsProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
