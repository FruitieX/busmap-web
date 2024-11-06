with import <nixpkgs> {};
stdenv.mkDerivation {
  name = "env";
  buildInputs = [
    bashInteractive
    nodejs_22
    yarn
  ];

  shellHook =
    ''
    export PATH=node_modules/.bin:$PATH
    '';
}
