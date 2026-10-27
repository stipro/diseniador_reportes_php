<?php
/**
 * Plantilla general de controladores
 * @version 2.0.0
 *
 * Controlador de creador_reporte_tcpdf
 */
class creador_reporte_tcpdfController extends Controller implements ControllerInterface
{
  function __construct()
  {
    // Prevenir el ingreso si nos encontramos en producción y esta ruta es sólo para desarrollo o pruebas
    // if (!is_local()) {
    //   Redirect::to(DEFAULT_CONTROLLER);
    // }
    
    // Validación de sesión de usuario, descomentar si requerida
    // if (!Auth::validate()) {
    //  Flasher::new('Debes iniciar sesión primero.', 'danger');
    //  Redirect::to('login');
    // }

    // Ejecutar la funcionalidad del Controller padre
    parent::__construct();
    $this->setViewDirectory('creador_reporte_tcpdf');
  }
  
  function index()
  {
    $this->setTitle('Diseñador de reportes');
    $this->addToData('msg', 'Bienvenido al controlador de "creador_reporte_tcpdf", se ha creado con éxito si ves este mensaje.');
    $this->setEngine('bee');
    $this->setView('index'); // por defecto es index
    $this->render();
  }

  function ver($id)
  {
    $this->setTitle('Reemplazar título');
    $this->setEngine('bee');
    $this->setView('ver'); // por defecto es index
    $this->render();
  }

  function agregar()
  {
    $this->setTitle('Reemplazar título');
    $this->setEngine('bee');
    $this->setView('agregar'); // por defecto es index
    $this->render();
  }

  function post_agregar()
  {
    // Proceso de agregado
  }

  function editar($id)
  {
    $this->setTitle('Reemplazar título');
    $this->setEngine('bee');
    $this->setView('editar'); // por defecto es index
    $this->render();
  }

  function post_editar()
  {
    // Proceso de actualizado
  }

  function borrar($id)
  {
    // Proceso de borrado
  }
}
