import Link from "next/link";

export default function NotFound() {
  return (
    <section className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <Link className="mt-6 inline-block underline underline-offset-4" href="/">
          Back home
        </Link>
      </div>
    </section>
  );
}
