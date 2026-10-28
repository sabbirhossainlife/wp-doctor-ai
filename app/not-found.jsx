import Container from "../components/Container";

export default function NotFound() {
  return (
    <Container>
      <main className="py-16">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="mt-3 text-slate-600">
          That page does not exist in the Milestone 0 foundation yet.
        </p>
        <p className="mt-4">
          <a className="font-medium text-blue-700 underline" href="/">
            Back to home
          </a>
        </p>
      </main>
    </Container>
  );
}
