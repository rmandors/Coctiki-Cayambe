import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type CreateUserBody = {
  email?: string;
  password?: string;
  full_name?: string;
  role?: string;
};

function translateAuthError(message: string) {
  if (/already.*(registered|exists)/i.test(message)) {
    return "Ya existe una cuenta con ese correo";
  }
  if (/password/i.test(message)) {
    return "La contraseña no cumple las reglas del proyecto";
  }
  return message;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Método no permitido" }, { status: 405 });
    }

    const claims = ctx.userClaims as { id?: string; sub?: string } | null;
    const userId = claims?.id ?? claims?.sub;
    if (!userId) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await ctx.supabase
      .from("profiles")
      .select("role, active")
      .eq("id", userId)
      .single();

    if (
      profileError || !profile || profile.role !== "admin" ||
      profile.active !== true
    ) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    let body: CreateUserBody;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const role = body.role === "admin" ? "admin" : "cajero";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Correo inválido" }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json(
        { error: "La contraseña debe tener al menos 8 caracteres" },
        { status: 400 },
      );
    }
    if (fullName.length < 2) {
      return Response.json(
        { error: "Escribe el nombre de la persona" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { full_name: fullName },
    });

    if (error || !data.user) {
      return Response.json(
        { error: translateAuthError(error?.message ?? "No se pudo crear el usuario") },
        { status: 400 },
      );
    }

    return Response.json({
      id: data.user.id,
      email: data.user.email,
      role,
    });
  }),
};
