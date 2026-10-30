import Document, { Head, Html, Main, NextScript } from 'next/document';

// Pages whose <body> carried a class in the plain-HTML version.
const BODY_CLASS_BY_PAGE = { '/setup': 'bg-light', '/profile': 'profile-page', '/backend': 'backend-page' };

// Stylesheets, fonts and icons are the unchanged files from public/, so the
// React pages render with exactly the same styling as before.
export default class SegnitzDocument extends Document {
    render() {
        const bodyClassName = BODY_CLASS_BY_PAGE[this.props.__NEXT_DATA__?.page];

        return (
            <Html lang="de">
                <Head>
                    <link rel="stylesheet" href="/css/bootstrap.min.css?v=5cba8daeac92" />
                    <link rel="stylesheet" href="/css/style.css?v=ff3b4eb8ece4" />
                    <link rel="stylesheet" href="/css/bootstrap-icons-1.11.3/font/bootstrap-icons.min.css?v=f643d6fe7e67" />
                    <link rel="stylesheet" href="/css/fonts.css?v=4c58b1928a08" />
                    <link rel="preconnect" href="https://fonts.googleapis.com" />
                    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
                        rel="stylesheet" />
                    <link rel="icon" type="image/svg+xml" href="/img/favicon.svg?v=20260927" />
                    <link rel="icon" type="image/png" sizes="96x96" href="/img/favicon-96x96.png?v=20260927" />
                    <link rel="shortcut icon" href="/img/favicon.ico?v=20260927" />
                    <link rel="apple-touch-icon" sizes="180x180" href="/img/apple-touch-icon.png?v=20260927" />
                    <link rel="manifest" href="/img/site.webmanifest?v=20260927" />
                    <meta name="theme-color" content="#041C40" />
                </Head>
                <body className={bodyClassName}>
                    <Main />
                    <NextScript />
                </body>
            </Html>
        );
    }
}
