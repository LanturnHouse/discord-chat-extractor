/** Native tooltip of a sidebar row: its full name (rows are cut with an ellipsis), plus why a locked row cannot be selected. */
export function rowTitle(name: string, noAccess: string | null): string {
  return noAccess === null ? name : `${name} - ${noAccess}`;
}
