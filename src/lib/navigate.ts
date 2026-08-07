// SPA navigation usable from any page (App listens for popstate and updates the route).
export function navigate(route: string) {
  const path = route === 'home' ? '/' : `/${route}`;
  if (window.location.pathname !== path) {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}
