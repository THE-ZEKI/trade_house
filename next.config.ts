import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // les Server Actions utilisent des cookies : on garde une limite confortable
    serverActions: { bodySizeLimit: '2mb' },
  },
  // pdfkit sort du bundle.
  //
  // Sans cela, le bundler embarque pdfkit/js/pdfkit.node.mjs et l'export PDF
  // echoue a la premiere police tracee :
  //
  //     Cannot find module '#standard-fonts/Helvetica'
  //
  // pdfkit charge ses polices via un « subpath import » interne (#standard-fonts/
  // ...), que seul le resolveur de Node sait interpréter. Une fois le fichier
  // copie dans le bundle, cet alias n'a plus de sens : le fichier est la, mais
  // plus la table d'imports qui le definissait. Aucun correctif dans le code
  // appelant ne peut y remedier : l'echec survient pendant la resolution du
  // module, avant la premiere ligne de notre code.
  //
  // serverExternalPackages dit a Next de ne pas empaqueter le paquet : il reste
  // dans node_modules et Node le resout normalement, alias compris. C'est la
  // seule voie qui fonctionne reellement.
  serverExternalPackages: ['pdfkit'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
