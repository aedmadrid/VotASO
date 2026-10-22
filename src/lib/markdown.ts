import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Convierte el texto descriptivo en Markdown de una votación a HTML seguro
 * (misma política de sanitización que las notas de VerificASO).
 *
 * Las imágenes externas quedan permitidas solo sobre HTTPS: una imagen
 * servida por un tercero revela a ese tercero la IP del votante que consulta
 * la votación. Para un sistema que cuida la privacidad del elector, conviene
 * servir los recursos desde el propio dominio.
 */
export function renderElectionMarkdown(md: string | null | undefined): string {
  const raw = String(md ?? "").trim();
  if (!raw) return "";
  const parsed = marked.parse(raw, { async: false }) as string;
  return sanitizeHtml(parsed, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "h3",
      "h4",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
    },
    // Sin `http`: una imagen en claro además de filtrar la IP permite
    // interceptar el tráfico de forma trivial.
    allowedSchemes: ["https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}
