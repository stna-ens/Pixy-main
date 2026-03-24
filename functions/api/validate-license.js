export async function onRequestPost(context) {
  const LEMON_API_KEY = context.env.LEMONSQUEEZY_API_KEY;

  if (!LEMON_API_KEY) {
    return new Response(
      JSON.stringify({ valid: false, error: "Server misconfigured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(
      JSON.stringify({ valid: false, error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { license_key } = body;
  if (!license_key || typeof license_key !== "string") {
    return new Response(
      JSON.stringify({ valid: false, error: "Missing license_key" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const resp = await fetch(
      "https://api.lemonsqueezy.com/v1/licenses/validate",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${LEMON_API_KEY}`,
        },
        body: JSON.stringify({
          license_key,
          instance_name: "pixy_web",
        }),
      }
    );

    const data = await resp.json();

    return new Response(
      JSON.stringify({
        valid: data.valid === true,
        license_key: data.license_key,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return new Response(
      JSON.stringify({ valid: false, error: "Validation service unavailable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
