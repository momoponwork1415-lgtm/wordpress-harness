import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const normalizedRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) => {
      const segments = path.split("/");
      return (
        !path.startsWith("/") &&
        !path.includes("\\") &&
        !path.includes("\0") &&
        segments.every(
          (segment) =>
            segment.length > 0 && segment !== "." && segment !== "..",
        )
      );
    },
    { message: "File path must be a normalized POSIX relative path" },
  );

export const sourceFileEntrySchema = z.strictObject({
  path: normalizedRelativePathSchema,
  digest: digestSchema,
  size: z.number().int().nonnegative(),
});

export const canonicalFileManifestSchema = z
  .strictObject({
    kind: z.literal("canonical-file-manifest"),
    schemaVersion: z.literal(1),
    entries: z.array(sourceFileEntrySchema).min(1),
  })
  .superRefine((manifest, context) => {
    for (let index = 1; index < manifest.entries.length; index += 1) {
      const previous = manifest.entries[index - 1];
      const current = manifest.entries[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous.path >= current.path
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Canonical File Manifest paths must be unique and stably ordered",
          path: ["entries", index, "path"],
        });
      }
    }
  });

export type CanonicalFileManifest = z.infer<typeof canonicalFileManifestSchema>;
