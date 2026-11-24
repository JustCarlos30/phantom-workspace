import React, { useEffect } from 'react';
import '../mobile.css';

export default function MobileApp() {
  useEffect(() => { try { sessionStorage.removeItem('phantom:mobile:bearer'); } catch { /* storage unavailable */ } }, []);
  return <main className="mobile-app"><header className="mobile-heading"><h1>Phantom</h1></header><section className="mobile-pair">
    <h2>Se necesita la app nativa</h2>
    <p>El acceso móvil está migrando al protocolo seguro v2. El navegador ya no permite vincular dispositivos ni operar sesiones.</p>
    <p>Esta fase prepara la seguridad y el protocolo. La app oficial con claves protegidas y biometría por acción todavía no está disponible.</p>
    <p>Verifica la identidad y el certificado desde Ajustes en el escritorio. Nunca aceptes un certificado sin comprobar su huella por un canal independiente.</p>
  </section></main>;
}
