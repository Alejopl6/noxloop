//! Abrir un archivo del worktree de una tarea en el editor del operador (FR-007).
//!
//! La interfaz PIDE; la cascara decide y ejecuta (principio VIII: la interfaz no
//! ejecuta nada). Y como el webview es no confiable —cualquier script que se
//! cuele en la pagina puede llamar a `invoke`—, la cascara no abre lo que le
//! manden: abre solo lo que pasa [`validar_ruta`].
//!
//! # El criterio de ruta permitida, y por que es este
//!
//! Se abre un archivo si, UNA VEZ RESUELTOS LOS ENLACES SIMBOLICOS, es un
//! archivo regular que vive dentro de `<home de noxloop>/worktrees/`. Nada mas.
//!
//! - Es el sitio donde el motor crea los worktrees de las tareas
//!   (`packages/engine/src/driver.mjs`: `join(home, "worktrees", repo, ...)`), y
//!   el diff que ve el operador sale de ahi. No hace falta preguntarle nada al
//!   servicio para saberlo, asi que no hay un segundo canal que falsificar.
//! - El home se resuelve igual que lo resuelve el servicio que esta cascara
//!   lanza (`NOXLOOP_HOME`, si no `~/.noxloop`; `packages/service/src/home.mjs`),
//!   porque la cascara no le pasa `--home`: los dos ven el mismo directorio.
//! - Se descarto "cualquier ruta de un proyecto conocido": exigiria que la
//!   cascara consulte al servicio (un canal mas) o confie en una lista que le
//!   manda el propio webview, que es justo lo que no se puede hacer.
//! - `canonicalize` antes de comparar: sin eso, `worktrees/x/../../boveda` o un
//!   enlace simbolico dentro del worktree apuntando a `~/.ssh` pasarian la
//!   comprobacion de prefijo.
//!
//! # Por que sin shell
//!
//! Se lanza el ejecutable con sus argumentos (`Command::new` + `args`), nunca
//! `sh -c`. La ruta viene del webview: interpolada en una linea de shell, un
//! nombre de archivo con `;` o `$(...)` seria una ejecucion arbitraria. Y como
//! la ruta validada es absoluta (empieza por `/`), tampoco puede colarse como
//! una opcion del editor (`--algo`).

use std::path::{Path, PathBuf};

/// Los editores que se saben abrir en una linea. El orden es la preferencia
/// cuando el operador no elige.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Editor {
    VsCode,
    Cursor,
    Zed,
    Sublime,
}

pub const TODOS: [Editor; 4] = [Editor::VsCode, Editor::Cursor, Editor::Zed, Editor::Sublime];

impl Editor {
    pub fn id(self) -> &'static str {
        match self {
            Editor::VsCode => "vscode",
            Editor::Cursor => "cursor",
            Editor::Zed => "zed",
            Editor::Sublime => "sublime",
        }
    }

    pub fn nombre(self) -> &'static str {
        match self {
            Editor::VsCode => "Visual Studio Code",
            Editor::Cursor => "Cursor",
            Editor::Zed => "Zed",
            Editor::Sublime => "Sublime Text",
        }
    }

    pub fn desde_id(id: &str) -> Option<Editor> {
        TODOS.into_iter().find(|e| e.id() == id)
    }

    /// El CLI tal como queda en el `PATH` cuando el operador lo instalo.
    fn cli(self) -> &'static str {
        match self {
            Editor::VsCode => "code",
            Editor::Cursor => "cursor",
            Editor::Zed => "zed",
            Editor::Sublime => "subl",
        }
    }

    /// El CLI DENTRO del bundle, relativo a `/Applications`. Hace falta porque
    /// una app abierta desde Finder hereda un `PATH` minimo
    /// (`/usr/bin:/bin:/usr/sbin:/sbin`): sin buscar en el bundle, un editor
    /// instalado pero sin "Install 'code' command in PATH" no se detectaria.
    fn en_el_bundle(self) -> &'static str {
        match self {
            Editor::VsCode => "Visual Studio Code.app/Contents/Resources/app/bin/code",
            Editor::Cursor => "Cursor.app/Contents/Resources/app/bin/cursor",
            Editor::Zed => "Zed.app/Contents/MacOS/cli",
            Editor::Sublime => "Sublime Text.app/Contents/SharedSupport/bin/subl",
        }
    }

    /// Los argumentos para abrir `ruta` en `linea`, en la forma que cada uno
    /// entiende. VS Code y Cursor necesitan `-g` (`--goto`); sin el, `ruta:12`
    /// se lee como un archivo que se llama asi. Zed y Sublime aceptan
    /// `ruta:linea` directamente.
    pub fn argumentos(self, ruta: &Path, linea: Option<u32>) -> Vec<String> {
        let ruta = ruta.to_string_lossy().to_string();
        let destino = match linea {
            Some(n) if n > 0 => format!("{ruta}:{n}"),
            _ => ruta,
        };
        match self {
            Editor::VsCode | Editor::Cursor => vec!["-g".to_string(), destino],
            Editor::Zed | Editor::Sublime => vec![destino],
        }
    }
}

/// Donde se buscan los editores: los directorios de aplicaciones y los del
/// `PATH`. Se pasa entero para poder probarlo con directorios temporales.
pub struct Busqueda {
    pub aplicaciones: Vec<PathBuf>,
    pub path: Vec<PathBuf>,
}

impl Busqueda {
    /// La del sistema: `/Applications`, `~/Applications`, el `PATH` del proceso
    /// y los dos prefijos donde Homebrew deja los enlaces, que no estan en el
    /// `PATH` de una app lanzada desde Finder.
    pub fn del_sistema() -> Busqueda {
        let mut aplicaciones = vec![PathBuf::from("/Applications")];
        if let Some(home) = std::env::var_os("HOME") {
            aplicaciones.push(PathBuf::from(home).join("Applications"));
        }
        let mut path: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        for extra in ["/usr/local/bin", "/opt/homebrew/bin"] {
            let extra = PathBuf::from(extra);
            if !path.contains(&extra) {
                path.push(extra);
            }
        }
        Busqueda { aplicaciones, path }
    }

    /// El ejecutable con el que se lanza `editor`, si esta instalado. Primero
    /// el bundle (es el que corresponde a la app que el operador ve), despues
    /// el `PATH`.
    pub fn ejecutable(&self, editor: Editor) -> Option<PathBuf> {
        self.aplicaciones
            .iter()
            .map(|dir| dir.join(editor.en_el_bundle()))
            .chain(self.path.iter().map(|dir| dir.join(editor.cli())))
            .find(|candidato| es_ejecutable(candidato))
    }

    pub fn disponibles(&self) -> Vec<(Editor, PathBuf)> {
        TODOS
            .into_iter()
            .filter_map(|e| self.ejecutable(e).map(|p| (e, p)))
            .collect()
    }
}

fn es_ejecutable(ruta: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(ruta) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// El home de noxloop con la misma precedencia que el servicio: `NOXLOOP_HOME`
/// y si no `~/.noxloop`.
pub fn home_de_noxloop() -> Option<PathBuf> {
    if let Some(h) = std::env::var_os("NOXLOOP_HOME").filter(|h| !h.is_empty()) {
        return Some(PathBuf::from(h));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".noxloop"))
}

/// El unico directorio bajo el que se abre algo. Ver el comentario del modulo.
pub fn raiz_permitida() -> Option<PathBuf> {
    home_de_noxloop().map(|h| h.join("worktrees"))
}

/// Decide si `ruta` se puede abrir. Devuelve la ruta canonica (la que se le
/// pasa al editor) o la causa en texto para el operador.
pub fn validar_ruta(raiz: &Path, ruta: &Path) -> Result<PathBuf, String> {
    if !ruta.is_absolute() {
        return Err(format!(
            "La ruta {} no es absoluta; solo se abren archivos del worktree de una tarea.",
            ruta.display()
        ));
    }
    let raiz = raiz.canonicalize().map_err(|_| {
        format!(
            "No existe el directorio de worktrees de noxloop ({}); no hay nada que abrir.",
            raiz.display()
        )
    })?;
    let real = ruta.canonicalize().map_err(|_| {
        format!(
            "El archivo {} ya no existe: el worktree de la tarea pudo haberse limpiado al integrarla.",
            ruta.display()
        )
    })?;
    if real == raiz || !real.starts_with(&raiz) {
        return Err(format!(
            "{} esta fuera de los worktrees de noxloop ({}); la aplicacion solo abre archivos de las tareas.",
            ruta.display(),
            raiz.display()
        ));
    }
    if !real.is_file() {
        return Err(format!("{} no es un archivo.", ruta.display()));
    }
    Ok(real)
}

/// Elige el editor: el pedido si esta instalado, si no el primero detectado.
pub fn elegir(
    disponibles: &[(Editor, PathBuf)],
    pedido: Option<&str>,
) -> Result<(Editor, PathBuf), String> {
    if let Some(id) = pedido {
        let editor = Editor::desde_id(id).ok_or_else(|| format!("Editor desconocido: {id}."))?;
        return disponibles
            .iter()
            .find(|(e, _)| *e == editor)
            .cloned()
            .ok_or_else(|| format!("{} no esta instalado en esta maquina.", editor.nombre()));
    }
    disponibles.first().cloned().ok_or_else(|| {
        "No se detecto ningun editor soportado (VS Code, Cursor, Zed o Sublime Text) en \
         /Applications ni en el PATH."
            .to_string()
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn temporal(nombre: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("noxloop-editor-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn un_archivo_de_un_worktree_se_abre_con_su_ruta_canonica() {
        let home = temporal("dentro");
        let wt = home.join("worktrees/repo/I-1-T1/src");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join("a.ts"), b"x").unwrap();
        let raiz = home.join("worktrees");
        let ok = validar_ruta(&raiz, &wt.join("a.ts")).unwrap();
        assert_eq!(ok, wt.join("a.ts").canonicalize().unwrap());
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn fuera_de_los_worktrees_no_se_abre_nada() {
        let home = temporal("fuera");
        std::fs::create_dir_all(home.join("worktrees")).unwrap();
        std::fs::write(home.join("boveda.json"), b"secreto").unwrap();
        let raiz = home.join("worktrees");
        // Directa, con `..` y relativa.
        assert!(validar_ruta(&raiz, &home.join("boveda.json")).is_err());
        assert!(validar_ruta(&raiz, &raiz.join("../boveda.json")).is_err());
        assert!(validar_ruta(&raiz, Path::new("worktrees/../boveda.json")).is_err());
        assert!(validar_ruta(&raiz, Path::new("/etc/hosts")).is_err());
        std::fs::remove_dir_all(&home).ok();
    }

    #[cfg(unix)]
    #[test]
    fn un_enlace_simbolico_dentro_del_worktree_no_saca_el_archivo_fuera() {
        let home = temporal("enlace");
        let wt = home.join("worktrees/repo/t");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(home.join("secreto"), b"x").unwrap();
        std::os::unix::fs::symlink(home.join("secreto"), wt.join("inocente.ts")).unwrap();
        assert!(validar_ruta(&home.join("worktrees"), &wt.join("inocente.ts")).is_err());
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn ni_directorios_ni_archivos_que_no_existen_ni_la_raiz_misma() {
        let home = temporal("dirs");
        let wt = home.join("worktrees/repo/t");
        std::fs::create_dir_all(&wt).unwrap();
        let raiz = home.join("worktrees");
        assert!(validar_ruta(&raiz, &wt).is_err());
        assert!(validar_ruta(&raiz, &wt.join("no-existe.ts")).is_err());
        assert!(validar_ruta(&raiz, &raiz).is_err());
        // Y sin directorio de worktrees, nada.
        assert!(validar_ruta(&home.join("no-hay"), &wt).is_err());
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn cada_editor_recibe_la_linea_en_la_forma_que_entiende() {
        let r = Path::new("/w/a b;$(x).ts");
        assert_eq!(
            Editor::VsCode.argumentos(r, Some(12)),
            vec!["-g", "/w/a b;$(x).ts:12"]
        );
        assert_eq!(
            Editor::Cursor.argumentos(r, Some(3)),
            vec!["-g", "/w/a b;$(x).ts:3"]
        );
        assert_eq!(Editor::Zed.argumentos(r, Some(7)), vec!["/w/a b;$(x).ts:7"]);
        assert_eq!(
            Editor::Sublime.argumentos(r, Some(1)),
            vec!["/w/a b;$(x).ts:1"]
        );
        // Sin linea (o linea 0) se abre el archivo a secas.
        assert_eq!(
            Editor::VsCode.argumentos(r, None),
            vec!["-g", "/w/a b;$(x).ts"]
        );
        assert_eq!(Editor::Zed.argumentos(r, Some(0)), vec!["/w/a b;$(x).ts"]);
    }

    #[cfg(unix)]
    #[test]
    fn se_detecta_por_bundle_y_por_path_y_se_respeta_la_preferencia() {
        use std::os::unix::fs::PermissionsExt;
        let base = temporal("deteccion");
        let apps = base.join("Applications");
        let bin = base.join("bin");
        let zed = apps.join("Zed.app/Contents/MacOS/cli");
        std::fs::create_dir_all(zed.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(&zed, b"").unwrap();
        std::fs::set_permissions(&zed, std::fs::Permissions::from_mode(0o755)).unwrap();
        // `subl` en el PATH pero SIN permiso de ejecucion: no cuenta.
        std::fs::write(bin.join("subl"), b"").unwrap();
        std::fs::write(bin.join("cursor"), b"").unwrap();
        std::fs::set_permissions(bin.join("cursor"), std::fs::Permissions::from_mode(0o755))
            .unwrap();

        let busqueda = Busqueda {
            aplicaciones: vec![apps],
            path: vec![bin.clone()],
        };
        let hallados: Vec<Editor> = busqueda.disponibles().into_iter().map(|(e, _)| e).collect();
        assert_eq!(hallados, vec![Editor::Cursor, Editor::Zed]);

        let d = busqueda.disponibles();
        assert_eq!(elegir(&d, None).unwrap().0, Editor::Cursor);
        assert_eq!(elegir(&d, Some("zed")).unwrap(), (Editor::Zed, zed));
        assert!(elegir(&d, Some("vscode")).is_err());
        assert!(elegir(&d, Some("rm -rf")).is_err());
        assert!(elegir(&[], None).is_err());
        std::fs::remove_dir_all(&base).ok();
    }
}
