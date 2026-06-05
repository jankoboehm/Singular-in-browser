#!/usr/bin/env bash
set -eux

BASEDIR="$(pwd)"

if ! command -v emmake &> /dev/null; then
    echo "Please install and source Emscripten."
    echo "See https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

AUX_BUILD="$BASEDIR/emscripten/build"
AUX_PREFIX="$BASEDIR/emscripten/install"
EXTERN_DIR="$BASEDIR/emscripten/extern"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
REFRESH_VERIFIED_SOURCES="${REFRESH_VERIFIED_SOURCES:-1}"
FORCE_CONFIGURE="${FORCE_CONFIGURE:-0}"
WASM_HOST="${WASM_HOST:-wasm32-unknown-none}"

mkdir -p "$AUX_BUILD"
mkdir -p "$AUX_PREFIX"
mkdir -p "$EXTERN_DIR"

ensure_managed_extern_path() {
    local dest="$1"
    case "$dest" in
        "$EXTERN_DIR"/*) ;;
        *)
            echo "Refusing to replace unmanaged source directory: $dest"
            exit 1
            ;;
    esac
}

reset_managed_extern_tree() {
    local dest="$1"

    ensure_managed_extern_path "$dest"

    if [[ -e "$dest" ]]; then
        chmod -R u+rwX "$dest" 2>/dev/null || true
        rm -rf "$dest"
    fi
    mkdir -p "$dest"
}

use_cached_dependency() {
    local name="$1"
    local marker="$2"

    if [[ "$REFRESH_VERIFIED_SOURCES" != "1" ]] && [[ -f "$marker" ]]; then
        echo "Using cached $name install at $marker."
        return 0
    fi
    return 1
}

normalize_cached_libtool_archives() {
    local file

    [[ -d "$AUX_PREFIX/lib" ]] || return 0

    while IFS= read -r -d '' file; do
        sed -i \
            -e "s#/work/work/repo#$BASEDIR#g" \
            -e "s#/work/repo#$BASEDIR#g" \
            -e "s#-L/repo#-L$BASEDIR#g" \
            -e "s#'/repo#'$BASEDIR#g" \
            -e "s# /repo# $BASEDIR#g" \
            -e "s#=/repo#=$BASEDIR#g" \
            "$file"
    done < <(find "$AUX_PREFIX/lib" -type f -name '*.la' -print0)
}

cleanup_cached_generated_artifacts() {
    chmod u+rwx omalloc 2>/dev/null || true
    chmod u+rw \
        omalloc/omTables \
        omalloc/omTables1 \
        omalloc/omTables-omTables.o \
        omalloc/omTables1-omTables1.o \
        2>/dev/null || true
    rm -f \
        omalloc/omTables \
        omalloc/omTables1 \
        omalloc/omTables-omTables.o \
        omalloc/omTables1-omTables1.o
}

fetch_verified_tarball() {
    local name="$1"
    local url="$2"
    local tarball="$3"
    local sha256="$4"
    local dest="$5"

    ensure_managed_extern_path "$dest"

    if [[ -f "$tarball" ]] && ! echo "${sha256}  ${tarball}" | sha256sum -c -; then
        echo "Cached $name tarball has the wrong SHA-256; downloading a fresh copy."
        rm -f "$tarball"
    fi

    if [[ ! -f "$tarball" ]]; then
        echo "Downloading $name source..."
        curl -fsSL "$url" -o "$tarball"
    fi
    echo "${sha256}  ${tarball}" | sha256sum -c -
    if [[ "$REFRESH_VERIFIED_SOURCES" != "1" ]] && \
       [[ -d "$dest" ]] && \
       [[ -f "$dest/.singular-wasm-source-sha256" ]] && \
       [[ "$(cat "$dest/.singular-wasm-source-sha256")" == "$sha256" ]]; then
        echo "Reusing $name source tree with verified SHA-256 marker."
        return
    fi
    reset_managed_extern_tree "$dest"
    tar --no-same-owner --no-same-permissions -xf "$tarball" -C "$dest" --strip-components=1
    chmod -R u+rwX "$dest"
    echo "$sha256" > "$dest/.singular-wasm-source-sha256"
}

fetch_verified_git_commit() {
    local name="$1"
    local url="$2"
    local commit="$3"
    local dest="$4"

    ensure_managed_extern_path "$dest"

    if [[ "$REFRESH_VERIFIED_SOURCES" != "1" ]] && [[ -d "$dest/.git" ]]; then
        actual="$(git -C "$dest" rev-parse HEAD 2>/dev/null || true)"
        if [[ "$actual" == "$commit" ]]; then
            git -C "$dest" remote set-url origin "$url"
            echo "$commit" > "$dest/.git/singular-wasm-source-commit"
            echo "Reusing $name source tree at verified commit $commit."
            return
        fi
    fi

    if [[ -d "$dest/.git" ]]; then
        git -C "$dest" remote set-url origin "$url"
    elif [[ -e "$dest" ]]; then
        echo "Existing $name source at $dest is not a git checkout and cannot be verified."
        echo "Remove it or set up a fresh build directory before continuing."
        exit 1
    else
        echo "Fetching $name source at $commit..."
        git init "$dest"
        git -C "$dest" remote add origin "$url"
    fi

    git -C "$dest" fetch --depth 1 origin "$commit"
    git -C "$dest" checkout --detach FETCH_HEAD
    local actual
    actual="$(git -C "$dest" rev-parse HEAD)"
    if [[ "$actual" != "$commit" ]]; then
        echo "$name source verification failed: expected $commit, got $actual"
        exit 1
    fi
    git -C "$dest" reset --hard "$commit"
    git -C "$dest" clean -fdx
    echo "$commit" > "$dest/.git/singular-wasm-source-commit"
}

# Generate autotools scripts if missing
if [[ ! -f ./configure ]]; then
    ./autogen.sh
fi

# --- GMP ---
(
    if use_cached_dependency "GMP" "$AUX_PREFIX/lib/libgmp.a"; then exit 0; fi

    mkdir -p "$AUX_BUILD/gmp"
    cd "$AUX_BUILD/gmp"
    GMP_VERSION="${GMP_VERSION:-6.3.0}"
    GMP_TARBALL="$AUX_BUILD/gmp-${GMP_VERSION}.tar.xz"
    GMP_URL="${GMP_URL:-https://ftp.gnu.org/gnu/gmp/gmp-${GMP_VERSION}.tar.xz}"
    GMP_SHA256="${GMP_SHA256:-a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898}"
    fetch_verified_tarball "GMP" "$GMP_URL" "$GMP_TARBALL" "$GMP_SHA256" "$EXTERN_DIR/gmp"
    if [[ ! -f config.status ]]; then
        CC_FOR_BUILD=/usr/bin/gcc ABI=standard \
        emconfigure "$EXTERN_DIR/gmp/configure" \
            --build i686-pc-linux-gnu --host none \
            --disable-assembly --enable-cxx \
            --prefix="$AUX_PREFIX"
    fi
    emmake make -j"$JOBS"
    emmake make install
)

# --- MPFR ---
(
    if use_cached_dependency "MPFR" "$AUX_PREFIX/lib/libmpfr.a"; then exit 0; fi

    mkdir -p "$AUX_BUILD/mpfr"
    cd "$AUX_BUILD/mpfr"
    MPFR_VERSION="${MPFR_VERSION:-4.2.2}"
    MPFR_TARBALL="$AUX_BUILD/mpfr-${MPFR_VERSION}.tar.xz"
    MPFR_URL="${MPFR_URL:-https://www.mpfr.org/mpfr-${MPFR_VERSION}/mpfr-${MPFR_VERSION}.tar.xz}"
    MPFR_SHA256="${MPFR_SHA256:-b67ba0383ef7e8a8563734e2e889ef5ec3c3b898a01d00fa0a6869ad81c6ce01}"
    fetch_verified_tarball "MPFR" "$MPFR_URL" "$MPFR_TARBALL" "$MPFR_SHA256" "$EXTERN_DIR/mpfr"
    if [[ ! -f config.status ]]; then
        emconfigure "$EXTERN_DIR/mpfr/configure" \
            --build i686-pc-linux-gnu --host none \
            --with-gmp="$AUX_PREFIX" \
            --disable-shared \
            --prefix="$AUX_PREFIX"
    fi
    emmake make -j"$JOBS"
    emmake make install
)

# --- FLINT ---
(
    if use_cached_dependency "FLINT" "$AUX_PREFIX/lib/libflint.a"; then exit 0; fi

    mkdir -p "$AUX_BUILD/flint"
    cd "$AUX_BUILD/flint"
    FLINT_URL="${FLINT_URL:-https://github.com/wbhart/flint2.git}"
    FLINT_COMMIT="${FLINT_COMMIT:-edc75bc82fe42361c620a7204e3f5cc521efbc07}"
    fetch_verified_git_commit "FLINT" "$FLINT_URL" "$FLINT_COMMIT" "$EXTERN_DIR/flint2"
    if [[ ! -f "$EXTERN_DIR/flint2/configure" ]]; then
        cd "$EXTERN_DIR/flint2" && ./bootstrap.sh && cd -
    fi
    if [[ ! -f Makefile ]]; then
        emconfigure "$EXTERN_DIR/flint2/configure" \
            --build=i686-pc-linux-gnu \
            --host=none \
            --with-gmp="$AUX_PREFIX" \
            --with-mpfr="$AUX_PREFIX" \
            --disable-shared \
            --disable-assembly \
            --prefix="$AUX_PREFIX"
    fi
    emmake make -j"$JOBS"
    emmake make install
)

# --- CDDLIB ---
(
    if use_cached_dependency "cddlib" "$AUX_PREFIX/lib/libcddgmp.a"; then exit 0; fi

    CDDLIB_VERSION="${CDDLIB_VERSION:-0.94n}"
    CDDLIB_TARBALL="$AUX_BUILD/cddlib-${CDDLIB_VERSION}.tar.gz"
    CDDLIB_URL="${CDDLIB_URL:-https://github.com/cddlib/cddlib/releases/download/${CDDLIB_VERSION}/cddlib-${CDDLIB_VERSION}.tar.gz}"
    CDDLIB_SHA256="${CDDLIB_SHA256:-b87ee07ba2c1d0ab92a3e4eccacdf568f981a095a392e3b9efd7e7e4a9e125b1}"
    fetch_verified_tarball "cddlib" "$CDDLIB_URL" "$CDDLIB_TARBALL" "$CDDLIB_SHA256" "$EXTERN_DIR/cddlib"

    cd "$EXTERN_DIR/cddlib"
    
    if [[ ! -f configure ]]; then
        ./bootstrap
    fi

    if [[ ! -f Makefile ]]; then
        CPPFLAGS="-I$AUX_PREFIX/include" \
        LDFLAGS="-L$AUX_PREFIX/lib" \
        CFLAGS="-O2" \
        CXXFLAGS="-O2" \
        emconfigure ./configure \
            --with-gmp="$AUX_PREFIX" \
            --disable-shared \
            --prefix="$AUX_PREFIX"
    fi
    
    emmake make -j"$JOBS"
    emmake make install

    cd "$AUX_PREFIX/include"
    ln -sf cddlib/*.h .
    ln -sf cddmp.h cdd_mp.h
)

# --- NTL ---
(
    if use_cached_dependency "NTL" "$AUX_PREFIX/lib/libntl.a"; then exit 0; fi

    mkdir -p "$AUX_BUILD/ntl"
    cd "$AUX_BUILD/ntl"
    
    NTL_URL="${NTL_URL:-https://github.com/libntl/ntl.git}"
    NTL_COMMIT="${NTL_COMMIT:-be43be3554f366f3710d4121323ba67a5a256c96}"
    fetch_verified_git_commit "NTL" "$NTL_URL" "$NTL_COMMIT" "$EXTERN_DIR/ntl"
    cd "$EXTERN_DIR/ntl/src"
    
    if [[ ! -f makefile ]]; then
        emconfigure ./configure \
            CXX="em++" \
            CXXFLAGS="-O2 -fexceptions -s WASM=1 -s NODERAWFS=1" \
            PREFIX="$AUX_PREFIX" \
            GMP_PREFIX="$AUX_PREFIX" \
            NTL_GMP_LIP=on \
            NTL_STD_CXX14=on \
            SHARED=off \
            NATIVE=off \
            TUNE=generic \
            NTL_THREADS=off

        sed -e 's/^CC=gcc/CC=emcc -s NODERAWFS=1/' \
            -e 's/^WIZARD=on/WIZARD=off/' \
            makefile > makefile.patched
        mv makefile.patched makefile
    fi
    
    if ! emmake make -j"$JOBS"; then
        
        sed -e 's|^\t\./MakeDesc|\tchmod +x ./MakeDesc \&\& node ./MakeDesc|' \
            -e 's|^\t\./gen_gmp_aux|\tchmod +x ./gen_gmp_aux \&\& node ./gen_gmp_aux|' \
            -e 's|^\t\./gen_lip_gmp_aux|\tchmod +x ./gen_lip_gmp_aux \&\& node ./gen_lip_gmp_aux|' \
            -e 's|^\t\./gen_lip_gmp_aux|\tchmod +x ./gen_lip_gmp_aux \&\& node ./gen_lip_gmp_aux|' \
            makefile > makefile.patched
        mv makefile.patched makefile
        
        sed -i 's|if ./CheckFeatures|if node ./CheckFeatures|g' MakeCheckFeatures
        
        if [ -f MakeCheckThreads ]; then
            sed -i 's|./CheckThreads|node ./CheckThreads|g' MakeCheckThreads
        fi
        
        emmake make -j"$JOBS"
    fi

    emmake make install
    emranlib "$AUX_PREFIX/lib/libntl.a"
)

# --- NORMALIZ ---
(
    if use_cached_dependency "Normaliz" "$AUX_PREFIX/lib/libnormaliz.a"; then exit 0; fi

    NORMALIZ_URL="${NORMALIZ_URL:-https://github.com/Normaliz/Normaliz.git}"
    NORMALIZ_COMMIT="${NORMALIZ_COMMIT:-72f5f3a10f14bf2dc67258f10c606cdb85f6835b}"
    fetch_verified_git_commit "Normaliz" "$NORMALIZ_URL" "$NORMALIZ_COMMIT" "$EXTERN_DIR/normaliz"

    cd "$EXTERN_DIR/normaliz"

    if [[ ! -f configure ]]; then
        echo "Bootstrapping Normaliz..."
        chmod +x bootstrap.sh
        ./bootstrap.sh
    fi

    if [[ ! -f Makefile ]]; then
        CPPFLAGS="-I$AUX_PREFIX/include" \
        LDFLAGS="-L$AUX_PREFIX/lib" \
        CFLAGS="-O2 -fexceptions" \
        CXXFLAGS="-O2 -fexceptions -std=c++14" \
        emconfigure ./configure \
            --build=i686-pc-linux-gnu \
            --host=none \
            --with-gmp="$AUX_PREFIX" \
            --with-flint="$AUX_PREFIX" \
            --disable-shared \
            --disable-openmp \
            --prefix="$AUX_PREFIX"
    fi
    
    emmake make -j"$JOBS"
    emmake make install
)

# --- TOPCOM ---
(
    if use_cached_dependency "TOPCOM" "$AUX_PREFIX/lib/libTOPCOM.a"; then exit 0; fi

    mkdir -p "$AUX_BUILD/topcom"
    cd "$AUX_BUILD/topcom"
    
    TOPCOM_VERSION="${TOPCOM_VERSION:-1_2_0_eta}"
    TOPCOM_TARBALL="$AUX_BUILD/TOPCOM-${TOPCOM_VERSION}.tgz"
    TOPCOM_URL="${TOPCOM_URL:-https://www.wm.uni-bayreuth.de/de/team/rambau_joerg/TOPCOM-Downloads/TOPCOM-${TOPCOM_VERSION}.tgz}"
    TOPCOM_SHA256="${TOPCOM_SHA256:-ca11e5c68c3b9ab1b2d5f105e184c7e443517bcbf0281e5c7bae7330c0d6789e}"
    fetch_verified_tarball "TOPCOM" "$TOPCOM_URL" "$TOPCOM_TARBALL" "$TOPCOM_SHA256" "$EXTERN_DIR/topcom"

    if [[ ! -f Makefile ]]; then
        CPPFLAGS="-I$AUX_PREFIX/include" \
        LDFLAGS="-L$AUX_PREFIX/lib -static -s USE_PTHREADS=0" \
        CFLAGS="-O2 -fexceptions -s USE_PTHREADS=0" \
        CXXFLAGS="-O2 -fexceptions -std=c++17 -s USE_PTHREADS=0" \
        emconfigure "$EXTERN_DIR/topcom/configure" \
            --build=i686-pc-linux-gnu \
            --host=none \
            --disable-shared \
            --enable-static \
            --prefix="$AUX_PREFIX"
            
        find . -type f -name "Makefile" -exec sed -i 's/ -pthread / /g; s/ -pthread$/ /g' {} +
        if [ -f libtool ]; then 
            sed -i 's/ -pthread / /g' libtool
            sed -i 's/"-pthread /"/g' libtool
            sed -i 's/ -pthread"/"/g' libtool
        fi
    fi
    
    emmake make -j"$JOBS"
    emmake make install
)

cd "$BASEDIR"

normalize_cached_libtool_archives

export EMCC_CFLAGS="-fexceptions"

emcc -c "$BASEDIR/emscripten/wasm_patch.c" -o "$BASEDIR/wasm_patch.o"
emar rcs "$BASEDIR/libwasm_patch.a" "$BASEDIR/wasm_patch.o"

CONFIGURE_STAMP="$BASEDIR/emscripten/.web-workbench-configure.args"
CONFIGURE_ARGS=(
    ac_cv_func_qsort_r=no
    ac_cv_sizeof_long=4
    ac_cv_sizeof_voidp=4
    ac_cv_sizeof_double=8
    ac_cv_sizeof_size_t=4
    --host="$WASM_HOST"
    --with-gmp="$AUX_PREFIX"
    --with-mpfr="$AUX_PREFIX"
    --with-flint="$AUX_PREFIX"
    --with-cdd="$AUX_PREFIX"
    --with-ntl="$AUX_PREFIX"
    --with-normaliz="$AUX_PREFIX"
    --with-topcom="$AUX_PREFIX"
    --disable-shared
    --enable-static
    --disable-maintainer-mode
    --without-pic
    --without-readline
    --enable-gfanlib
    --disable-polymake
    --disable-pthreads
    --disable-omalloc
    --enable-p-procs-static
    --disable-p-procs-dynamic
    --with-builtinmodules=syzextra,gfanlib,freealgebra,subsets,cohomo,loctriv,customstd,partialgb,sispasm
    CXX="em++ -fexceptions"
    CC="emcc -fexceptions"
    CXXFLAGS="-O2 -fexceptions -D_GNU_SOURCE -std=c++14 -I$AUX_PREFIX/include -I$AUX_PREFIX/include/cddlib"
    CFLAGS="-O2 -fexceptions -D_GNU_SOURCE -I$AUX_PREFIX/include -I$AUX_PREFIX/include/cddlib"
    LDFLAGS="-L$AUX_PREFIX/lib -L$BASEDIR -lwasm_patch -fexceptions -s ASYNCIFY=1 -s ALLOW_MEMORY_GROWTH=1 -s USE_PTHREADS=0 -s ERROR_ON_UNDEFINED_SYMBOLS=1 -O2"
)

write_configure_signature() {
    printf '%s\n' "${CONFIGURE_ARGS[@]}"
}

if [[ "$FORCE_CONFIGURE" != "1" ]] && [[ -f factory/libtool ]] && grep -Eq '^(host|host_os)=.*darwin' factory/libtool; then
    echo "Detected native libtool state in cached tree; forcing Emscripten reconfigure."
    FORCE_CONFIGURE=1
fi

if [[ "$FORCE_CONFIGURE" == "1" ]] || [[ ! -f config.status ]] || [[ ! -f Makefile ]]; then
    find . \
        \( -name libtool -o -name config.status -o -name config.log -o -name config.cache \) \
        -type f -delete

    emconfigure ./configure "${CONFIGURE_ARGS[@]}"
    write_configure_signature > "$CONFIGURE_STAMP"

    # Native/generated p-procs artifacts from another checkout configuration can
    # be copied into the Docker context. Force regeneration for the static WASM
    # configuration chosen above, but only when configuring the cached tree.
    rm -f libpolys/polys/templates/p_Procs.inc libpolys/polys/p_Procs_Generate
elif [[ ! -f "$CONFIGURE_STAMP" ]]; then
    echo "Configure signature is missing; rerunning Singular configure."
    find . \
        \( -name libtool -o -name config.status -o -name config.log -o -name config.cache \) \
        -type f -delete

    emconfigure ./configure "${CONFIGURE_ARGS[@]}"
    write_configure_signature > "$CONFIGURE_STAMP"

    # Native/generated p-procs artifacts from another checkout configuration can
    # be copied into the Docker context. Force regeneration for the static WASM
    # configuration chosen above, but only when configuring the cached tree.
    rm -f libpolys/polys/templates/p_Procs.inc libpolys/polys/p_Procs_Generate
elif ! write_configure_signature | cmp -s "$CONFIGURE_STAMP" -; then
    find . \
        \( -name libtool -o -name config.status -o -name config.log -o -name config.cache \) \
        -type f -delete

    emconfigure ./configure "${CONFIGURE_ARGS[@]}"
    write_configure_signature > "$CONFIGURE_STAMP"

    # Native/generated p-procs artifacts from another checkout configuration can
    # be copied into the Docker context. Force regeneration for the static WASM
    # configuration chosen above, but only when configuring the cached tree.
    rm -f libpolys/polys/templates/p_Procs.inc libpolys/polys/p_Procs_Generate
else
    echo "Using cached Singular configure at $BASEDIR. Set FORCE_CONFIGURE=1 to rerun."
fi

cleanup_cached_generated_artifacts

emmake make -j"$JOBS"

echo "Building static modules..."

for mod in syzextra gfanlib freealgebra subsets cohomo loctriv customstd partialgb sispasm; do
    echo "Building module: $mod"
    emmake make -C "Singular/dyn_modules/$mod" -j"$JOBS"
done

cp "$BASEDIR/emscripten/wasm_patch.c" "$BASEDIR/Singular"
cd Singular

MODULE_LIBS="
    dyn_modules/syzextra/.libs/libsyzextra.a \
    dyn_modules/gfanlib/.libs/libgfanlib.a \
    dyn_modules/freealgebra/.libs/libfreealgebra.a \
    dyn_modules/subsets/.libs/libsubsets.a \
    dyn_modules/cohomo/.libs/libcohomo.a \
    dyn_modules/loctriv/.libs/libloctriv.a \
    dyn_modules/customstd/.libs/libcustomstd.a \
    dyn_modules/partialgb/.libs/libpartialgb.a \
    dyn_modules/sispasm/.libs/libsispasm.a"

em++ wasm_patch.c tesths.o utils.o \
    -Wl,--start-group \
    ./.libs/libSingular.a \
    ../libpolys/polys/.libs/libpolys.a \
    ../factory/.libs/libfactory.a \
    ../resources/.libs/libsingular_resources.a \
    $MODULE_LIBS \
    -Wl,--end-group \
    -L"$AUX_PREFIX/lib" \
    -lTOPCOM -lnormaliz -lflint -lmpfr -lcddgmp -lntl -lgmp\
    -s ASYNCIFY=1 \
    -s TOTAL_STACK=64MB \
    -s INITIAL_MEMORY=1024MB \
    -s ALLOW_MEMORY_GROWTH=1 \
    -fexceptions \
    -O2 \
    --preload-file LIB@/LIB \
    --preload-file ../doc@/info \
    -s FORCE_FILESYSTEM=1 \
    -s EXPORTED_RUNTIME_METHODS='["FS","TTY","PATH","callMain","ccall","cwrap"]' \
    -s ENVIRONMENT=web,worker \
    -s EXIT_RUNTIME=1 \
    -o Singular.js

echo "Build complete."
