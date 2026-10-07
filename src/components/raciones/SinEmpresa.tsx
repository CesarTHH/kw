/** Aviso cuando un rol de alcance "todas" aún no eligió empresa. */
export function SinEmpresa() {
  return (
    <main className="mx-auto mt-12 max-w-md px-4">
      <p className="panel text-center text-oliva">
        Elige una empresa en el selector de arriba para registrar raciones a su nombre.
      </p>
    </main>
  );
}
