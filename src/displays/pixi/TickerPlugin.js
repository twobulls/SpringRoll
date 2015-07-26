/**
 *	@module Core
 *	@namespace springroll
 */
(function()
{
	// Include classes
	var ticker = include('PIXI.ticker.shared', false);
	
	if(!ticker) return;

	/**
	 *	Create an app plugin for resizing application, all properties and methods documented
	 *	in this class are mixed-in to the main Application
	 *	@class TickerPlugin
	 *	@extends springroll.ApplicationPlugin
	 */
	var TickerPlugin = function()
	{
		ApplicationPlugin.call(this);
	};

	/**
	*  Keep track of total time elapsed to feed to the Ticker
	*  @property {Number} _time
	*  @private
	*  @default 0
	*/
	var _time = 0;
	
	ticker.autoStart = false;
	ticker.stop();

	// Reference to the prototype
	var p = extend(TickerPlugin, ApplicationPlugin);

	p.setup = function()
	{
		//update early so that the InteractionManager updates in response to mouse movements
		//and what the user saw the previous frame
		this.on('update', updateTicker, -3);
	};
	
	function updateTicker(elapsed)
	{
		_time += elapsed;
		ticker.update(_time);
	}

	// Register plugin
	ApplicationPlugin.register(TickerPlugin);

}());