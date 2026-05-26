import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://byvbrsuvporwhlapecja.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dmJyc3V2cG9yd2hsYXBlY2phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc5MDgsImV4cCI6MjA5NTQwMzkwOH0.iEHk3ZH34o4OXZYVqejKRT0ti0VJ7FbFaU728ioGxo8"
);

export async function uploadPdf(file, songId) {
  const path = `${songId}.pdf`;
  const { error } = await supabase.storage
    .from("pdfs")
    .upload(path, file, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("pdfs").getPublicUrl(path);
  return data.publicUrl;
}

