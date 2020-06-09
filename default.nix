with import <nixpkgs> {};
stdenv.mkDerivation {
  name = "env";
  buildInputs = [
    bashInteractive
    nodejs-12_x
    yarn
  ];

  shellHook =
    ''
    export PATH=node_modules/.bin:$PATH
    '';
}
