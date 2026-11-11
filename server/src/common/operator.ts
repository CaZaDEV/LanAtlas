/** Nom que queda a «creat per» / «modificat per». Aplicació d'un sol usuari: es pot canviar amb OPERATOR_NAME. */
export const OPERATOR = process.env.OPERATOR_NAME?.trim() || 'Admin';
