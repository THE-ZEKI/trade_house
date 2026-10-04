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
  // pdfkit sort du bundle (voir l'explication plus bas), et ses polices
  // standard doivent ETRE COPIEES sur Vercel.
  //
  // Les deux reglages vont ensemble et sont indissociables :
  //
  //   serverExternalPackages : sans lui, le bundler embarque le paquet et
  //     l'alias interne '#standard-fonts/...' n'a plus de sens — le fichier est
  //     present, la table d'imports qui le definissait non. L'echec survient
  //     a la RESOLUTION, avant toute ligne de notre code.
  //
  //   outputFileTracingIncludes : avec le paquet external, Vercel ne suit plus
  //     que les imports STATIQUES, or ces polices sont chargees par un alias
  //     dynamique qu'aucun import ne mentionne. Les fichiers .cjs/.mjs ne sont
  //     donc pas copies, et l'erreur devient :
  //
  //         Cannot find module '/var/task/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs'
  //
  //     Le paquet est bien la, les polices non. C'est exactement ce second
  //     symptome, et il ne se corrige qu'ici : la declaration doit etre
  //     explicite, le traceur ne peut pas deviner un alias.
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: {
    // Les DEUX routes qui generent un PDF. N'en lister qu'une laisserait
    // l'autre echouer avec la meme erreur : le traceur travaille par route,
    // pas par paquet. Les couper par motif plutot que par chemin exact evite
    // d'avoir a re declarer a chaque nouvelle route d'export.
    '/api/reports/**': ['./node_modules/pdfkit/js/standard-fonts/**'],
    '/api/training/**': ['./node_modules/pdfkit/js/standard-fonts/**'],
  },
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
