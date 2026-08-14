import { LoginForm } from "./LoginForm";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="mb-8 flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Lost Boys Demolition
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sign in to continue
        </p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
