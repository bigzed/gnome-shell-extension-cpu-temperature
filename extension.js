const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;

function CpuTemperature() {
    this._init.apply(this, arguments);
}

CpuTemperature.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,

    _init: function(){
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'temperature');

        this.statusLabel = new St.Label({
            text: "--",
            style_class: "temperature-label"
        });

        // destroy all previously created children, and add our statusLabel
        this.actor.get_children().forEach(function(c) {
            c.destroy()
        });
        this.actor.add_actor(this.statusLabel);

        this.sensorsPath = this._detectSensors();
        this.hddtempPath = this._detectHDDTemp();
        this.command=["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/issues/"];
        if(this.sensorsPath){
            this.title='Error';
            this.content='Run sensors-detect as root. If it doesn\'t help, click here to report with your sensors output!';
        }
        else{
            this.title='Warning';
            this.content='Please install lm_sensors. If it doesn\'t help, click here to report with your sensors output!';
        }

        this._update_temp();
        //update every 15 seconds
        event = GLib.timeout_add_seconds(0, 15, Lang.bind(this, function () {
            this._update_temp();
            return true;
        }));
    },

    _detectSensors: function(){
        //detect if sensors is installed
        let ret = GLib.spawn_command_line_sync("which sensors");
        if ( (ret[0]) && (ret[3] == 0) ) {//if yes
            return ret[1].toString().split("\n", 1)[0];//find the path of sensors
        }
        return null;
    },

    _detectHDDTemp: function(){
        //detect if hddtemp is installed
        let hddtempPath = null;
        let ret = GLib.spawn_command_line_sync("which hddtemp");
        if ( (ret[0]) && (ret[3] == 0) ) {//if yes
            hddtempPath =ret[1].toString().split("\n", 1)[0];
            // for any reason it is not possible to run hddtemp directly.
            if(GLib.spawn_command_line_sync(hddtempPath)[3])
                hddtempPath = null;
        }
        return hddtempPath;
    },

    _update_temp: function() {
        let items = new Array();
        let tempInfo=null;
        if (this.sensorsPath){
            let sensors_output = GLib.spawn_command_line_sync(this.sensorsPath);//get the output of the sensors command
            if(sensors_output[0]) tempInfo = this._findTemperatureFromSensorsOutput(sensors_output[1].toString());//get temperature from sensors
            if (tempInfo){
                var s=0, n=0;//sum and count
                for (let sensor in tempInfo){
                    s+=tempInfo[sensor]['temp'];
                    n++;
                    items.push(tempInfo[sensor]['label']+': '+this._formatTemp(tempInfo[sensor]['temp']));
                }
                if (n!=0){//if temperature is detected
                    this.title=this._formatTemp(s/n);//set title as average
                }
            }
        }
        if (this.hddtempPath){
            let hddtemp_output = GLib.spawn_command_line_sync(this.hddtempPath);//get the output of the hddtemp command
            if(hddtemp_output[0]) tempInfo = this._findTemperatureFromHDDTempOutput(hddtemp_output[1].toString());//get temperature from hddtemp
            if(tempInfo){
                for (let sensor in tempInfo){
                    items.push('Disk ' + tempInfo[sensor]['label']+': '+this._formatTemp(tempInfo[sensor]['temp']));
                }
            }
        }
        //if we don't have the temperature yet, use some known files
        if(!tempInfo){
            tempInfo = this._findTemperatureFromFiles();
            if(tempInfo.temp){
                this.title=this._formatTemp(tempInfo.temp);
                items.push('Current Temperature : '+this._formatTemp(tempInfo.temp));
                if (tempInfo.crit)
                    items.push('Critical Temperature : '+this._formatTemp(tempInfo.crit));
            }
        }

        this.statusLabel.set_text(this.title);
        this.menu.box.get_children().forEach(function(c) {
            c.destroy()
        });
        let section = new PopupMenu.PopupMenuSection("Temperature");
        if (items.length>0){
            let item;
            for each (let itemText in items){
                item = new PopupMenu.PopupMenuItem("");
                item.addActor(new St.Label({
                    text:itemText,
                    style_class: "sm-label"
                }));
                section.addMenuItem(item);
            }
        }else{
            let command=this.command;
            let item = new PopupMenu.PopupMenuItem("");
            item.addActor(new St.Label({
                text:this.content,
                style_class: "sm-label"
            }));
            item.connect('activate',function() {
                Util.spawn(command);
            });
            section.addMenuItem(item);
        }
        this.menu.addMenuItem(section);
    },

    _findTemperatureFromFiles: function(){
        let info = new Array();
        let temp_files = [
        //hwmon for new 2.6.39, 3.x linux kernels
        '/sys/class/hwmon/hwmon0/temp1_input',
        '/sys/devices/platform/coretemp.0/temp1_input',
        '/sys/bus/acpi/devices/LNXTHERM\:00/thermal_zone/temp',
        '/sys/devices/virtual/thermal/thermal_zone0/temp',
        '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_input',
        //old kernels with proc fs
        '/proc/acpi/thermal_zone/THM0/temperature',
        '/proc/acpi/thermal_zone/THRM/temperature',
        '/proc/acpi/thermal_zone/THR0/temperature',
        '/proc/acpi/thermal_zone/TZ0/temperature',
        //Debian Sid/Experimental on AMD-64
        '/sys/class/hwmon/hwmon0/device/temp1_input'];
        for each (let file in temp_files){
            if(GLib.file_test(file,1<<4)){
                //let f = Gio.file_new_for_path(file);
                //f.read_async(0, null, function(source, result) {debug(source.read_finish(result).read())});

                let temperature = GLib.file_get_contents(file);
                if(temperature[0]) {
                    info['temp']= parseInt(temperature[1])/1000;
                }
            }
            break;
        }
        let crit_files = ['/sys/devices/platform/coretemp.0/temp1_crit',
        '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_crit',
        //hwmon for new 2.6.39, 3.0 linux kernels
        '/sys/class/hwmon/hwmon0/temp1_crit',
        //Debian Sid/Experimental on AMD-64
        '/sys/class/hwmon/hwmon0/device/temp1_crit'];
        for each (let file in crit_files){
            if(GLib.file_test(file,1<<4)){
                let temperature = GLib.file_get_contents(file);
                if(temperature[0]) {
                    info['crit']= parseInt(temperature[1])/1000;
                }
            }
        }
        return info;
    },

    _findTemperatureFromSensorsOutput: function(txt){
        let sensors_output=txt.split("\n");
        let feature_label=undefined;
        let feature_value=undefined;
        let s= new Array();
        let n=0,c=0;
        let f;
        //iterate through each lines
        for(let i = 0; i < sensors_output.length; i++) {
            // ignore chipset driver name and 'Adapter:' line for now
            i+=2;
            // get every feature of the chip
            while(sensors_output[i]){
               // if it is not a continutation of a feature line
               if(sensors_output[i].indexOf(' ') != 0){
                  let feature = this._parseSensorsTemperatureLine(feature_label, feature_value);
                  if (feature) {
                      s[n++] = feature;
                      feature = undefined;
                  }
                  [feature_label, feature_value]=sensors_output[i].split(':');
               }
               else{
                  feature_value += sensors_output[i];
               }
               i++; 
            }
        }
        let feature = this._parseSensorsTemperatureLine(feature_label, feature_value);
        if (feature) {
            s[n++] = feature;
            feature = undefined;
        }
        return s;
    },

    _parseSensorsTemperatureLine: function(label, value) {
        let s = undefined;
        if(label != undefined && value != undefined) {
            let curValue = value.trim().split('  ')[0];
            // does the current value look like a temperature unit (°C)?
            if(curValue.indexOf("C", curValue.length - "C".length) !== -1){
                s = new Array();
                s['label'] = label.trim();
                s['temp'] = parseFloat(curValue.split(' ')[0]);
                s['high'] = this._getHigh(value);
                s['crit'] = this._getCrit(value);
                s['hyst'] = this._getHyst(value);
            }
        }
        return s;
    },

    _findTemperatureFromHDDTempOutput: function(txt){
        let hddtemp_output=txt.split("\n");
        let s= new Array();
        let n=0;
        for(let i = 0; i < hddtemp_output.length; i++)
        {
            if(hddtemp_output[i]){
                s[++n] = new Array();
                s[n]['label'] = hddtemp_output[i].split(': ')[0].split('/');
                s[n]['label'] = s[n]['label'][s[n]['label'].length - 1];
                s[n]['temp'] = parseFloat(hddtemp_output[i].split(': ')[2]);
            }
        }
        return s;
    },

    _getHigh: function(t){
        let r;
        return (r=/high=\+(\d{1,3}.\d)/.exec(t))?parseFloat(r[1]):null;
    },

    _getCrit: function(t){
        let r;
        return (r=/crit=\+(\d{1,3}.\d)/.exec(t))?parseFloat(r[1]):null;
    },

    _getHyst: function(t){
        let r;
        return (r=/hyst=\+(\d{1,3}.\d)/.exec(t))?parseFloat(r[1]):null;
    },


    _toFahrenheit: function(c){
        return ((9/5)*c+32).toFixed(1);
    },

    _formatTemp: function(t) {
        //uncomment the next line to display temperature in Fahrenheit
        //return (Math.round(this._toFahrenheit(t))).toString()+"\u00b0F";
        return (Math.round(t)).toString()+"\u00b0C";
    }
}

//for debugging
function debug(a){
    global.log(a);
    Util.spawn(['echo',a]);
}

function init() {
//do nothing
}

let indicator;
let event=null;

function enable() {
    indicator = new CpuTemperature();
    Main.panel.addToStatusArea('temperature', indicator);
}

function disable() {
    indicator.destroy();
    Mainloop.source_remove(event);
    indicator = null;
}
