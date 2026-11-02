import { useEffect, useRef } from "react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider, MAIN_ID, ThemeProvider } from "@willowsum/ui";
import { GalleryTokensPage } from "./pages/GalleryTokensPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { SectionPage } from "./pages/SectionPage.tsx";
import { GALLERY_TOKENS_PATH, sectionForPath } from "./routing/routes.ts";
import { useHashPath } from "./routing/useHashPath.ts";

function Router() {
  const path = useHashPath();
  const first = useRef(true);

  // DS-14 item 8: after moving to another page, focus goes to the main area.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById(MAIN_ID)?.focus();
    window.scrollTo(0, 0);
  }, [path]);

  if (path === GALLERY_TOKENS_PATH) return <GalleryTokensPage />;
  const section = sectionForPath(path);
  return section ? <SectionPage section={section} /> : <NotFoundPage />;
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
