// Estado de escopo módulo compartilhado entre abas do admin.
// Mantido como `let` exportado + setters para os casos onde o valor é trocado
// inteiramente (Map/Set). Mutações in-place em objetos/arrays são feitas
// diretamente nos getters.

export let allUsers = [];
export function setAllUsers(v) { allUsers = v; }

export let _myUid = null;
export function setMyUid(v) { _myUid = v; }

export let selectedUserId = null;
export function setSelectedUserId(v) { selectedUserId = v; }

export let _adminIds = new Set();
export function setAdminIds(v) { _adminIds = v; }

export let _onlineRefreshInterval = null;
export function setOnlineRefreshInterval(v) { _onlineRefreshInterval = v; }

// volumeCategories é mutado in-place (volumeCategories[vol.key] = ...) em
// várias seções. Exporta o objeto raiz; quem mutar mantém a referência.
export const volumeCategories = {};

// _reportNotes idem — { report_id: [notes] } mutado in-place.
export const _reportNotes = {};
