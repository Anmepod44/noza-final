import React, { useState, useEffect } from 'react';
import Amplify, { Auth } from 'aws-amplify';
import { AmplifyAuthenticator, AmplifySignOut } from '@aws-amplify/ui-react';
import { Signer } from "@aws-amplify/core";
import Location from "aws-sdk/clients/location";
import Pin from './Pin'
import useInterval from './useInterval'
import ReactMapGL, { Marker, NavigationControl } from "react-map-gl";
import awsconfig from './aws-exports';
import "mapbox-gl/dist/mapbox-gl.css";
import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';

const indexName = "casmir-amplify-index";
const trackerName = "amplify-tracker";
const deviceID = "eta_device124";
const routeCalculator = "amplify-calculator";
const apiKey = "your-api-key";
const mapName = "third_map";
const region = "eu-north-1";

Amplify.configure(awsconfig);
let AWS = require('aws-sdk');

const transformRequest = (credentials) => (url, resourceType) => {
  if (resourceType === "Style" && !url?.includes("://")) {
    url = `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor?key=${apiKey}`;
  }

  if (url?.includes("amazonaws.com")) {
    return {
      url: Signer.signUrl(url, {
        access_key: "your-access-key",
        secret_key: "your-secret-key"
      })
    };
  }

  return { url: url || "" };
};

function Header(props) {
  return (
    <div className="container">
      <div className="row">
        <div className="col-10">
          <h2>CASMIR BUS TRACKER APPLICATION</h2>
        </div>
        <div className="col-2">
          <AmplifySignOut />
        </div>
      </div>
    </div>
  );
}

function Search(props) {
  const [place, setPlace] = useState('New York');

  const handleChange = (event) => {
    setPlace(event.target.value);
  };

  const handleClick = (event) => {
    event.preventDefault();
    props.searchPlace(place);
  };

  return (
    <div className="container">
      <div className="input-group">
        <input type="text" className="form-control form-control-lg" placeholder="Search for Places" aria-label="Place" aria-describedby="basic-addon2" value={place} onChange={handleChange} />
        <div className="input-group-append">
          <button onClick={handleClick} className="btn btn-primary" type="submit">Search</button>
        </div>
      </div>
    </div>
  );
}

function Track(props) {
  const handleClick = (event) => {
    event.preventDefault();
    props.trackDevice();
  };

  return (
    <div className="container">
      <div className="input-group">
        <div className="input-group-append">
          <button onClick={handleClick} className="btn btn-primary" type="submit">Track</button>
        </div>
      </div>
    </div>
  );
}

const App = () => {
  let trackingLongitude;
  let trackingLatitude;
  const [credentials, setCredentials] = useState(null);
  const [viewport, setViewport] = useState({
    longitude: -123.1187,
    latitude: 49.2819,
    zoom: 10,
  });
  const [client, setClient] = useState(null);
  const [eta, setEta] = useState(null);
  const [marker, setMarker] = useState({
    longitude: -123.1187,
    latitude: 49.2819,
  });
  const [devPosMarkers, setDevPosMarkers] = useState([]);
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    const fetchCredentials = async () => {
      if (isMounted) {
        setCredentials(await Auth.currentUserCredentials());
      }
    };

    fetchCredentials();

    const createClient = async () => {
      if (isMounted) {
        const credentials = await Auth.currentCredentials();
        const newClient = new Location({
          credentials,
          region: awsconfig.aws_project_region,
        });
        setClient(newClient);
      }
    };

    createClient();

    return () => {
      setIsMounted(false);
    };
  }, [isMounted]);

  useInterval(() => {
    if (isMounted) {
      getDevicePosition();
    }
  }, 30000);

  const searchPlace = (place) => {
    if (!client || !isMounted) return;

    const params = {
      IndexName: indexName,
      Text: place,
    };

    client.searchPlaceIndexForText(params, (err, data) => {
      if (err) console.error(err);
      if (data) {
        const coordinates = data.Results[0]?.Place?.Geometry?.Point;
        if (coordinates) {
          setViewport({
            longitude: coordinates[0],
            latitude: coordinates[1],
            zoom: 10,
          });

          setMarker({
            longitude: coordinates[0],
            latitude: coordinates[1],
          });
        }
      }
    });
  };

  const getDevicePosition = () => {
    if (!client || !isMounted) return;

    setDevPosMarkers([]);
    const params = {
      DeviceId: deviceID,
      TrackerName: trackerName,
      StartTimeInclusive: "2021-02-02T19:05:07.327Z",
      EndTimeExclusive: new Date(),
    };

    client.getDevicePositionHistory(params, (err, data) => {
      if (err) console.log(err, err.stack);
      if (data) {
        const tempPosMarkers = data.DevicePositions.map(function (devPos, index) {
          return {
            index: index,
            long: devPos.Position[0],
            lat: devPos.Position[1],
          };
        });

        setDevPosMarkers(tempPosMarkers);
        const pos = tempPosMarkers.length - 1;

        setViewport({
          longitude: tempPosMarkers[pos]?.long || viewport.longitude,
          latitude: tempPosMarkers[pos]?.lat || viewport.latitude,
          zoom: 12,
        });

        trackingLongitude = tempPosMarkers[pos]?.long;
        trackingLatitude = tempPosMarkers[pos]?.lat;
        myRouteCalculator(trackingLongitude, trackingLatitude);
      }
    });
  };

  const myRouteCalculator = (long, lat) => {
    if (!client || !isMounted) return;

    const parameter = {
      CalculatorName: routeCalculator,
      DeparturePosition: [long, lat],
      DestinationPosition: [-74.03330326080321, 40.741859668270294],
    };

    client.calculateRoute(parameter, (err, data) => {
      if (err) console.log(err);
      if (data) {
        const deliveryETA = data.Legs[0]?.DurationSeconds;

        const etaInMins = Math.round(deliveryETA / 60);
        setEta(etaInMins);

        if (deliveryETA < 300 && deliveryETA > 100) {
          const params = {
            Message: 'Estimated Arrival time is 5 mins',
            TopicArn: "arn:aws:sns:eu-north-1:622811571324:eventbridge-lambda:40203b56-b700-4665-9885-858104e3e298"
          };
          
          const publishTextPromise = new AWS.SNS({credentials}).publish(params).promise();
          
          publishTextPromise.then(
            function(data) {
              console.log(`Message ${params.Message} sent to the topic ${params.TopicArn}`);
              console.log("MessageID is " + data.MessageId);
            }).catch(
              function(err) {
              console.error(err, err.stack);
            });
        }
      }
    });
  };

  const trackerMarkers = React.useMemo(() => devPosMarkers.map(
    pos => (
      <Marker key={pos.index} longitude={pos.long} latitude={pos.lat} >
        <Pin text={pos.index + 1} size={20} />
      </Marker>
    )), [devPosMarkers]);

  return (
    <AmplifyAuthenticator>
      <div className="App">
        <Header />
        <br />
        <div>
          <Search searchPlace={searchPlace} />
        </div>
        <br />
        <div>
          {eta
            ? <div>
              <h5>AWS BUS ARRIVAL TIME IS IN : {eta} mins</h5>
            </div>
            : <div></div>
          }
          <Track trackDevice={getDevicePosition} />
        </div>
        <br />
        <div>
          {credentials ? (
            <ReactMapGL
              {...viewport}
              width="100%"
              height="100vh"
              transformRequest={transformRequest(credentials)}
              mapStyle={mapName}
              onViewportChange={setViewport} 
            >
              <Marker
                longitude={marker.longitude}
                latitude={marker.latitude}
                offsetTop={-20}
                offsetLeft={-10}
              >
                <Pin size={20} />
              </Marker>

              {trackerMarkers}

              <div style={{ position: "absolute", left: 20, top: 20 }}>
                <NavigationControl showCompass={false} />
              </div>
            </ReactMapGL>
          ) : (
            <h1>Loading...</h1>
          )}
        </div>
      </div>
    </AmplifyAuthenticator>
  );
};

export default App;
