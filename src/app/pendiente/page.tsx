import { MarcoPublico } from "@/components/MarcoPublico";

export default function PaginaPendiente() {
  return (
    <MarcoPublico version={false}>
      <h1 className="text-center text-2xl font-semibold text-white">Cuenta en revisión</h1>
      <p className="text-center text-white">
        Tu solicitud de registro está pendiente de aprobación. Te avisaremos por correo cuando puedas ingresar.
      </p>
      <form action="/salir" method="post">
        <button type="submit" className="btn-oliva">Salir</button>
      </form>
    </MarcoPublico>
  );
}
