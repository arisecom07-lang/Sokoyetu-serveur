// Sokoyetu — mémoire de l'appareil (localStorage / sessionStorage), sans jamais faire planter l'application.
const P = 'sokoyetu:';

export const Local = {
  lire(k, defaut) { try { const v = localStorage.getItem(P + k); return v == null ? defaut : JSON.parse(v); } catch (e) { return defaut; } },
  ecrire(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  retirer(k) { try { localStorage.removeItem(P + k); } catch (e) { } },
  cles() { try { return Object.keys(localStorage).filter((k) => k.startsWith(P)).map((k) => k.slice(P.length)); } catch (e) { return []; } }
};

export const Session = {
  lire(k, defaut) { try { const v = sessionStorage.getItem(P + k); return v == null ? defaut : JSON.parse(v); } catch (e) { return defaut; } },
  ecrire(k, v) { try { sessionStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { } },
  retirer(k) { try { sessionStorage.removeItem(P + k); } catch (e) { } }
};
