import { z } from "zod";

/**
 * Identifiers that end up in a URL path. Restricting them to letters, digits
 * and dashes keeps "." / ".." (which URL normalisation would turn into a
 * different route) and any delimiter out of the request path.
 */
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/, "must consist of letters, digits and dashes (e.g. a UUID)");

export const regionSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be a region code such as eu-north-1");
